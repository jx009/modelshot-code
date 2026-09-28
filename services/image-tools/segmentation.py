"""CPU SlimSAM with bounded image-embedding reuse. No downloads at runtime."""
from collections import OrderedDict
import hashlib
from pathlib import Path
import time

import cv2
import numpy as np
import onnxruntime as ort
from PIL import Image


class Segmenter:
    def __init__(self, directory, threads=2, cache_size=4, ttl=600):
        options = ort.SessionOptions()
        options.intra_op_num_threads = max(1, min(8, threads))
        options.inter_op_num_threads = 1
        options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        options.add_session_config_entry("session.intra_op.allow_spinning", "0")
        root = Path(directory)
        self.encoder = ort.InferenceSession(str(root / "vision_encoder_quantized.onnx"), options, providers=["CPUExecutionProvider"])
        self.decoder = ort.InferenceSession(str(root / "prompt_encoder_mask_decoder_quantized.onnx"), options, providers=["CPUExecutionProvider"])
        self.cache, self.cache_size, self.ttl = OrderedDict(), cache_size, ttl

    def embedding(self, source, data):
        key = hashlib.sha256(data).hexdigest()
        now = time.monotonic()
        for old in list(self.cache):
            if now - self.cache[old]["time"] > self.ttl:
                del self.cache[old]
        if key in self.cache:
            self.cache.move_to_end(key)
            return self.cache[key], True
        scale = 1024 / max(source.size)
        width, height = (int(side * scale + 0.5) for side in source.size)
        pixels = np.asarray(source.convert("RGB").resize((width, height), Image.Resampling.BILINEAR), dtype=np.float32) / 255
        pixels = (pixels - np.array([0.485, 0.456, 0.406], dtype=np.float32)) / np.array([0.229, 0.224, 0.225], dtype=np.float32)
        padded = np.zeros((1024, 1024, 3), dtype=np.float32)
        padded[:height, :width] = pixels
        outputs = self.encoder.run(None, {"pixel_values": padded.transpose(2, 0, 1)[None]})
        entry = {"time": now, "outputs": dict(zip((o.name for o in self.encoder.get_outputs()), outputs)), "resized": (width, height), "size": source.size}
        self.cache[key] = entry
        while len(self.cache) > self.cache_size:
            self.cache.popitem(last=False)
        return entry, False

    def predict(self, entry, points, labels):
        values = {**entry["outputs"], "input_points": np.asarray(points, dtype=np.float32)[None], "input_labels": np.asarray(labels, dtype=np.int64)[None]}
        output = dict(zip((o.name for o in self.decoder.get_outputs()), self.decoder.run(None, values)))
        return output["pred_masks"][0], output["iou_scores"][0]

    @staticmethod
    def low_mask(logits, entry, source_size=None):
        # The decoder works on the padded 1024 square. Undo that padding before
        # scaling directly back to the original image; an intermediate 384px
        # resize loses thin edges and makes small false components more visible.
        width, height = entry["resized"]
        restored = cv2.resize(logits, (1024, 1024), interpolation=cv2.INTER_LINEAR)[:height, :width]
        original_size = entry.get("size") or source_size
        if not original_size:
            raise ValueError("Source size is required to restore a mask")
        return cv2.resize(restored, original_size, interpolation=cv2.INTER_LINEAR)

    @staticmethod
    def _selection_prompt(selection, entry, source_size):
        """Build box points plus interior points for a free-form lasso."""
        mask = np.asarray(selection.convert("L"), dtype=np.uint8)
        box = selection.convert("L").getbbox()
        if not box:
            raise ValueError("No selected region")
        left, top, right, bottom = box
        width, height = source_size
        resized_width, resized_height = entry["resized"]
        scale_x, scale_y = resized_width / width, resized_height / height
        points = [[left * scale_x, top * scale_y], [right * scale_x, bottom * scale_y]]
        labels = [2, 3]

        # A rectangle is already a complete box prompt. A lasso has useful
        # shape information that the decoder can consume as positive points.
        fill = float(np.count_nonzero(mask[top:bottom, left:right])) / max(1, (right - left) * (bottom - top))
        if fill < 0.985:
            distance = cv2.distanceTransform((mask > 0).astype(np.uint8), cv2.DIST_L2, 5)
            min_distance = max(3.0, min(width, height) * 0.008)
            for _ in range(6):
                y, x = np.unravel_index(int(np.argmax(distance)), distance.shape)
                if distance[y, x] < min_distance:
                    break
                points.append([x * scale_x, y * scale_y])
                labels.append(1)
                cv2.circle(distance, (int(x), int(y)), max(8, round(min(width, height) * 0.08)), 0, -1)
        return [points], [labels], fill

    @staticmethod
    def _clean_mask(mask, selection):
        """Remove decoder specks and fill small holes without erasing thin parts."""
        binary = (mask > 0).astype(np.uint8)
        if not np.any(binary):
            return binary
        kernel_size = 5 if min(binary.shape) >= 512 else 3
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
        binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)
        binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)
        count, labels, stats, _ = cv2.connectedComponentsWithStats(binary, 8)
        if count <= 1:
            return binary

        selected = np.asarray(selection, dtype=np.uint8) > 0
        overlap = np.bincount(labels[selected], minlength=count)
        areas = stats[:, cv2.CC_STAT_AREA].copy()
        areas[0] = 0
        primary = int(np.argmax(overlap * 4 + areas))
        minimum = max(64, int(areas[primary] * 0.06))
        keep = np.zeros_like(binary)
        for component in range(1, count):
            if areas[component] >= minimum and overlap[component] > 0:
                keep[labels == component] = 1
        if not np.any(keep):
            keep[labels == primary] = 1

        # External contours deliberately fill interior pinholes caused by the
        # low-resolution decoder while preserving the silhouette boundary.
        contours, _ = cv2.findContours(keep, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        filled = np.zeros_like(keep)
        cv2.drawContours(filled, contours, -1, 1, thickness=cv2.FILLED)
        return filled

    @staticmethod
    def _candidate_score(mask, raw, selection, model_score, lasso):
        selected = np.asarray(selection, dtype=np.uint8) > 0
        value = mask > 0
        overlap = np.count_nonzero(value & selected)
        union = np.count_nonzero(value | selected)
        iou = overlap / max(1, union)
        outside = np.count_nonzero(value & ~selected) / max(1, np.count_nonzero(value))
        raw_area = max(1, np.count_nonzero(raw))
        coherence = np.count_nonzero(value) / raw_area
        if lasso:
            # For a lasso, staying inside the user's outline is more reliable
            # than the decoder's generic IoU ranking.
            return 3.0 * iou + 2.0 * (1.0 - outside) + 0.5 * coherence + 0.1 * float(model_score)
        return 0.8 * float(model_score) + 1.4 * iou + 0.4 * coherence - 0.3 * outside

    def select(self, source, data, selection):
        entry, _ = self.embedding(source, data)
        points, labels, fill = self._selection_prompt(selection, entry, source.size)
        masks, scores = self.predict(entry, points, labels)
        selection_mask = np.asarray(selection.convert("L"), dtype=np.uint8)
        lasso = fill < 0.985
        candidates = []
        for index, logits in enumerate(masks[0]):
            restored = self.low_mask(logits, entry, source.size)
            raw = (restored > 0).astype(np.uint8)
            cleaned = self._clean_mask(raw, selection_mask)
            candidates.append((self._candidate_score(cleaned, raw, selection_mask, scores[0][index], lasso), cleaned))
        _, selected = max(candidates, key=lambda candidate: candidate[0])

        # Keep the user's outline as a guardrail, with a small dilation so a
        # hand-drawn contour does not shave pixels off the object.
        margin = max(2, round(min(source.size) * 0.012))
        roi_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (margin * 2 + 1, margin * 2 + 1))
        roi = cv2.dilate(selection_mask, roi_kernel)
        alpha = (selected * (roi > 0)).astype(np.uint8) * 255
        alpha = np.minimum(alpha, np.asarray(source.getchannel("A")))
        if not np.any(alpha):
            raise ValueError("No object detected")
        result = source.copy()
        result.putalpha(Image.fromarray(alpha))
        return result
