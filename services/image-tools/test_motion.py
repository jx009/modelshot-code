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
    def test_storyboard_exports_camera_moves_crossfades_captions_and_ducked_music(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            frame = directory / "frame.png"; Image.new("RGB", (640, 360), "#3366cc").save(frame)
            voice, music = directory / "voice.wav", directory / "music.wav"
            for path, seconds, tone in ((voice, 1.5, 660), (music, 8, 220)):
                subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"sine=frequency={tone}:duration={seconds}", "-ac", "2", str(path)], check=True)
            media = {"frame": (frame, {"type": "image"}), "voice": (voice, inspect_media(voice)), "music": (music, inspect_media(music))}
            scenes = [
                dict(id="a", name="开场", duration=2, title="", subtitle="", assetId="frame", source="ai-image", camera="缓慢推近",
                     narration="欢迎来到新品发布会。今天带来一款安静的咖啡机。", narrationAssetId="voice", transition="fade", animation="none", trimStart=0, volume=0),
                dict(id="b", name="结尾", duration=2, title="立即体验", subtitle="", assetId=None, source="text", background="#111827",
                     transition="cut", animation="rise", fontSize=64, color="#ffffff", align="center", position="center", trimStart=0, volume=0),
            ]
            composition = {"ratio": "16:9", "scenes": scenes, "subtitles": True, "audio": {"assetId": "music", "volume": .6, "trimStart": 0}}
            output = directory / "storyboard.mp4"; output.write_bytes(render(composition, media, directory))
            info = inspect_media(output)
            # 一次 0.5 秒交叉转场：2 + 2 - 0.5
            self.assertAlmostEqual(info["duration"], 3.5, delta=.25)
            self.assertTrue(info["hasAudio"])
            self.assertEqual((info["width"], info["height"]), (1280, 720))
            with self.assertRaises(HTTPException):
                render({**composition, "scenes": [{**scenes[0], "transition": "wipe"}]}, media, directory)
            with self.assertRaises(HTTPException):
                render({**composition, "scenes": [{**scenes[0], "narrationAssetId": "frame"}]}, media, directory)

    def test_caption_chunks_follow_punctuation_and_length(self):
        from motion import caption_chunks, camera_move
        chunks = caption_chunks("欢迎来到新品发布会。今天我们带来一款全新的咖啡机，它小巧、安静，而且一键就能做出拿铁！", 20)
        self.assertTrue(all(len(chunk) <= 20 for chunk in chunks))
        self.assertEqual("".join(chunks), "欢迎来到新品发布会。今天我们带来一款全新的咖啡机，它小巧、安静，而且一键就能做出拿铁！")
        self.assertEqual(camera_move({"camera": "镜头拉远"}), "out")
        self.assertEqual(camera_move({"camera": "从左向右平移"}), "left")
        self.assertEqual(camera_move({"id": "same"}), camera_move({"id": "same"}))


if __name__ == "__main__":
    unittest.main()
