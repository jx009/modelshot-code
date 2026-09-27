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
        # scaling back to a small, stable mask for the original image.
        width, height = entry["resized"]
        restored = cv2.resize(logits, (1024, 1024), interpolation=cv2.INTER_LINEAR)[:height, :width]
        original_size = entry.get("size") or source_size
        if not original_size:
            raise ValueError("Source size is required to restore a mask")
        longest = max(original_size)
        size = tuple(max(1, round(value / longest * 384)) for value in original_size)
        return cv2.resize(restored, size, interpolation=cv2.INTER_LINEAR)

    def select(self, source, data, selection):
        entry, _ = self.embedding(source, data)
        box = selection.convert("L").getbbox()
        if not box:
            raise ValueError("No selected region")
        rw, rh = entry["resized"]
        left, top, right, bottom = box
        points = [[[left * rw / source.width, top * rh / source.height], [right * rw / source.width, bottom * rh / source.height]]]
        masks, scores = self.predict(entry, points, [[2, 3]])
        logits = masks[0][int(np.argmax(scores[0]))]
        low = self.low_mask(logits, {**entry, "resized": (rw, rh)}, source.size)
        alpha = (cv2.resize(low, source.size, interpolation=cv2.INTER_LINEAR) > 0).astype(np.uint8) * 255
        alpha = np.minimum(alpha, np.asarray(selection.convert("L")))
        alpha = np.minimum(alpha, np.asarray(source.getchannel("A")))
        if not np.any(alpha):
            raise ValueError("No object detected")
        result = source.copy()
        result.putalpha(Image.fromarray(alpha))
        return result
