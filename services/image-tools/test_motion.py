"""CI-only smoke coverage: actual MP4 encoding, streams, and trim validation."""
import json
import base64
from io import BytesIO
from pathlib import Path
import subprocess
import tempfile
import unittest

from fastapi import HTTPException
from PIL import Image
from motion import render, inspect_media, inspect_video_poster


class MotionExportTest(unittest.TestCase):
    def test_multiscene_animation_exports_playable_video_and_audio(self):
        scenes = [dict(id=str(i), name=effect, duration=1, title="开始流动", subtitle="Preview export",
                       background="#111827", color="#ffffff", fontSize=64, align="center",
                       position="center", animation=effect, assetId=None, trimStart=0, volume=0)
                  for i, effect in enumerate(["fade", "rise", "zoom"])]
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            data = render({"ratio": "16:9", "scenes": scenes}, {}, directory)
            output = directory / "test.mp4"; output.write_bytes(data)
            info = inspect_media(output)
            self.assertEqual((info["type"], info["width"], info["height"]), ("video", 1280, 720))
            self.assertAlmostEqual(info["duration"], 3, delta=.2)
            self.assertTrue(info["hasAudio"])
            poster = inspect_video_poster(output)
            self.assertAlmostEqual(poster["duration"], info["duration"], delta=.1)
            with Image.open(BytesIO(base64.b64decode(poster["poster"]))) as image:
                self.assertLessEqual(max(image.size), 640)
                self.assertEqual(image.format, "JPEG")
            streams = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-of", "json", str(output)], capture_output=True, check=True).stdout)["streams"]
            self.assertTrue(any(stream["codec_name"] == "h264" for stream in streams))
            self.assertTrue(any(stream["codec_name"] == "aac" for stream in streams))
            scene = {**scenes[0], "assetId": "clip", "trimStart": 1, "volume": .5}
            clipped = render({"ratio": "9:16", "scenes": [scene]}, {"clip": (output, info)}, directory)
            self.assertEqual(clipped[4:8], b"ftyp")
            scene["trimStart"] = 3
            with self.assertRaises(HTTPException):
                render({"ratio": "9:16", "scenes": [scene]}, {"clip": (output, info)}, directory)

    def test_rejects_nonmedia_and_invalid_compositions(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder); path = directory / "fake.mp4"
            path.write_text("This is not a video", encoding="utf-8")
            with self.assertRaises(HTTPException): inspect_media(path)
            with self.assertRaises(HTTPException): render({"ratio": "16:9", "scenes": []}, {}, directory)

    def test_plain_media_keeps_its_brightness_without_caption_shade(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            source = directory / "red.png"
            Image.new("RGB", (80, 60), "red").save(source)
            scene = dict(id="clip", name="Clip", duration=1, title="", subtitle="", assetId="image",
                         animation="none", fontSize=64, color="#ffffff", background="#111827", trimStart=0, volume=0)
            output = directory / "plain.mp4"
            output.write_bytes(render({"ratio": "16:9", "scenes": [scene]}, {"image": (source, {"type": "image"})}, directory))
            poster = inspect_video_poster(output)
            with Image.open(BytesIO(base64.b64decode(poster["poster"]))).convert("RGB") as image:
                self.assertGreater(image.getpixel((image.width // 2, image.height // 2))[0], 230)


if __name__ == "__main__":
    unittest.main()
