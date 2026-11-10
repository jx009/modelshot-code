"""Bounded motion rendering. Only validated local uploads; no URLs or shell."""
import json
import base64
import math
from pathlib import Path
import re
import subprocess
import time

from fastapi import HTTPException
from PIL import Image, ImageDraw, ImageFont

SIZES = {"16:9": (1280, 720), "9:16": (720, 1280), "1:1": (720, 720), "4:5": (720, 900)}
FONT = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"

def run(args, timeout=60):
    try:
        return subprocess.run(args, check=True, capture_output=True, timeout=timeout)
    except (subprocess.SubprocessError, OSError) as exc:
        raise HTTPException(422, "Media processing failed") from exc

def inspect_media(path):
    with path.open("rb") as source: header = source.read(16)
    # Reject playlists and text manifests before ffprobe can follow local paths.
    if not (header[4:8] == b"ftyp" or header[:3] == b"ID3" or header[:4] in (b"RIFF", b"fLaC", b"OggS") or len(header) >= 2 and header[0] == 255 and header[1] & 224 == 224):
        raise HTTPException(415, "Unsupported media signature")
    data = json.loads(run(["ffprobe", "-v", "error", "-protocol_whitelist", "file,pipe", "-show_format", "-show_streams", "-of", "json", str(path)], 15).stdout)
    streams = data.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video" and not s.get("disposition", {}).get("attached_pic")), None)
    audio = any(s.get("codec_type") == "audio" for s in streams)
    duration = float(data.get("format", {}).get("duration", 0))
    if not math.isfinite(duration) or duration <= 0 or duration > 1800 or not (video or audio):
        raise HTTPException(422, "Invalid media duration")
    if video and (video.get("width", 0) * video.get("height", 0) > 16_777_216 or max(video.get("width", 0), video.get("height", 0)) > 8192):
        raise HTTPException(413, "Video dimensions too large")
    formats = set(data.get("format", {}).get("format_name", "").split(","))
    if video and not formats.intersection({"mov", "mp4"}):
        raise HTTPException(415, "Use MP4 or MOV video")
    if not video and not formats.intersection({"mp3", "wav", "mov", "mp4", "aac", "flac", "ogg"}):
        raise HTTPException(415, "Unsupported audio")
    return {"type": "video" if video else "audio", "duration": duration, "width": video.get("width", 0) if video else 0, "height": video.get("height", 0) if video else 0, "hasAudio": audio,
            "contentType": "video/quicktime" if video and path.suffix == ".mov" else "video/mp4" if video else "audio/mpeg" if "mp3" in formats else "audio/wav" if "wav" in formats else "audio/mp4" if formats.intersection({"mov", "mp4"}) else "audio/aac" if "aac" in formats else "audio/flac" if "flac" in formats else "audio/ogg"}

def number(value, low, high):
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) or not low <= value <= high:
        raise HTTPException(422, "Invalid motion number")
    return value


def inspect_video_poster(path):
    info = inspect_media(path)
    if info["type"] != "video":
        raise HTTPException(415, "Video required")
    # One frame, one decoder thread, no network protocols or unbounded output.
    poster = run(["ffmpeg", "-v", "error", "-threads", "1", "-protocol_whitelist", "file,pipe", "-i", str(path),
                  "-frames:v", "1", "-vf", "scale=640:640:force_original_aspect_ratio=decrease", "-threads", "1",
                  "-f", "image2pipe", "-vcodec", "mjpeg", "-q:v", "4", "pipe:1"], 20).stdout
    if not poster or len(poster) > 1024 * 1024:
        raise HTTPException(422, "Invalid video poster")
    return {**info, "poster": base64.b64encode(poster).decode("ascii")}

def color(value):
    if not isinstance(value, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
        raise HTTPException(422, "Invalid color")
    return value

def text_layer(scene, size, destination):
    width, height = size
    scale = width / (720 if width <= height else 1280)
    title_size = round(number(scene.get("fontSize", 64), 24, 120) * scale)
    title_font = ImageFont.truetype(FONT, title_size)
    subtitle_font = ImageFont.truetype(FONT, max(1, round(title_size * .42)))
    image = Image.new("RGBA", size, (0, 0, 0, 0)); draw = ImageDraw.Draw(image)
    lines = []
    for value, font, limit in [(scene.get("title", ""), title_font, 160), (scene.get("subtitle", ""), subtitle_font, 320)]:
        if not isinstance(value, str) or len(value) > limit: raise HTTPException(422, "Invalid text")
        for paragraph in value.splitlines():
            line = ""
            for char in paragraph:
                if line and draw.textlength(line + char, font=font) > width * .82:
                    lines.append((line, font)); line = char
                else: line += char
            if line: lines.append((line, font))
    total = sum(font.size * 1.4 for _, font in lines)
    if total > height * .82: raise HTTPException(422, "Text does not fit; reduce text or font size")
    y = height * .09 if scene.get("position") == "top" else height * .91 - total if scene.get("position") == "bottom" else (height - total) / 2
    fill = color(scene.get("color", "#ffffff"))
    for line, font in lines:
        length = draw.textlength(line, font=font)
        x = width * .09 if scene.get("align") == "left" else width * .91 - length if scene.get("align") == "right" else (width - length) / 2
        draw.text((x, y), line, font=font, fill=fill, stroke_width=0); y += font.size * 1.4
    image.save(destination, "PNG")

def render(composition, media, directory):
    size = SIZES.get(composition.get("ratio")); scenes = composition.get("scenes")
    if not size or not isinstance(scenes, list) or not 1 <= len(scenes) <= 40 or not all(isinstance(scene, dict) for scene in scenes): raise HTTPException(422, "Invalid composition")
    durations = [number(s.get("duration"), 1, 30) for s in scenes]
    if sum(durations) > 180: raise HTTPException(422, "Video exceeds 180 seconds")
    width, height = size; deadline = time.monotonic() + 480
    outputs = []
    for index, (scene, duration) in enumerate(zip(scenes, durations)):
        text_path = directory / f"text-{index}.png"; text_layer(scene, size, text_path)
        output = directory / f"scene-{index}.mp4"
        args = ["ffmpeg", "-v", "error", "-nostdin", "-y", "-threads", "1", "-filter_complex_threads", "1"]
        asset = media.get(scene.get("assetId")); trim = number(scene.get("trimStart", 0), 0, 1800)
        volume = number(scene.get("volume", 0), 0, 1)
        if asset and asset[1]["type"] == "image": args += ["-loop", "1", "-framerate", "24", "-i", str(asset[0])]
        elif asset and asset[1]["type"] == "video":
            if trim + duration > asset[1]["duration"] + .1: raise HTTPException(422, "Trim exceeds video duration")
            args += ["-protocol_whitelist", "file,pipe", "-ss", str(trim), "-i", str(asset[0])]
        elif scene.get("assetId"): raise HTTPException(422, "Invalid scene media")
        else: args += ["-f", "lavfi", "-i", f"color=c={color(scene.get('background', '#111827'))}:s={width}x{height}:r=24"]
        args += ["-loop", "1", "-framerate", "24", "-i", str(text_path), "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
        shade = ",drawbox=x=0:y=0:w=iw:h=ih:color=black@0.333:t=fill" if asset and (scene.get("title", "").strip() or scene.get("subtitle", "").strip()) else ""
        base = f"[0:v]scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},setsar=1,fps=24,setpts=PTS-STARTPTS{shade}[bg];"
        animation = scene.get("animation", "rise")
        if animation not in {"none", "fade", "rise", "zoom"}: raise HTTPException(422, "Invalid animation")
        overlay = "[1:v]format=rgba"
        if animation != "none": overlay += ",fade=t=in:st=0:d=0.5:alpha=1"
        if animation == "zoom": overlay += f",scale=w='trunc({width}*(0.94+0.06*min(t/0.5,1))/2)*2':h='trunc({height}*(0.94+0.06*min(t/0.5,1))/2)*2':eval=frame"
        overlay += "[fg];[bg][fg]overlay=x=(W-w)/2:y=" + ("'(H-h)/2+24*max(0,1-t/0.5)'" if animation == "rise" else "(H-h)/2") + ":shortest=1,format=yuv420p[v];"
        source_audio = "0:a" if asset and asset[1].get("hasAudio") and volume else "2:a"
        audio = f"[{source_audio}]atrim=duration={duration},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume={volume if source_audio == '0:a' else 0},apad[a]"
        args += ["-filter_complex", base + overlay + audio, "-map", "[v]", "-map", "[a]", "-t", str(duration), "-c:v", "libx264", "-threads", "1", "-preset", "veryfast", "-crf", "22", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(output)]
        run(args, max(1, min(120, deadline - time.monotonic()))); outputs.append(output)
    concat = directory / "concat.txt"; concat.write_text("".join(f"file '{path.name}'\n" for path in outputs), encoding="utf-8")
    joined = directory / "joined.mp4"
    run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-f", "concat", "-safe", "1", "-i", str(concat), "-c", "copy", "-movflags", "+faststart", str(joined)], 30)
    track = composition.get("audio")
    if track:
        asset = media.get(track.get("assetId"))
        if not asset or asset[1]["type"] != "audio": raise HTTPException(422, "Invalid soundtrack")
        volume = number(track.get("volume", .5), 0, 1); trim = number(track.get("trimStart", 0), 0, asset[1]["duration"])
        if trim >= asset[1]["duration"]: raise HTTPException(422, "Soundtrack trim exceeds duration")
        final = directory / "final.mp4"
        run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-i", str(joined), "-protocol_whitelist", "file,pipe", "-ss", str(trim), "-i", str(asset[0]), "-filter_complex_threads", "1", "-filter_complex", f"[1:a]volume={volume},apad[m];[0:a][m]amix=inputs=2:duration=first:normalize=0[a]", "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-t", str(sum(durations)), "-movflags", "+faststart", str(final)], 60)
        joined = final
    if joined.stat().st_size > 128 * 1024 * 1024: raise HTTPException(413, "Output too large")
    return joined.read_bytes()
