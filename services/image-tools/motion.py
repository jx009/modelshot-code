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

# ── 分镜成片：字幕、推拉镜头、转场、旁白与配乐 ──
SOURCES = {"ai-image-video", "ai-video", "ai-image", "media", "text"}
FADE = 0.5
CAPTION_BREAK = re.compile(r"(?<=[。！？!?；;，,、\n])")


def caption_chunks(text, limit):
    """按标点切分旁白，每段不超过 limit 个字，依次显示。"""
    parts = [part.strip() for part in CAPTION_BREAK.split(text) if part.strip()]
    chunks, current = [], ""
    for part in parts:
        while len(part) > limit:
            if current:
                chunks.append(current); current = ""
            chunks.append(part[:limit]); part = part[limit:]
        if current and len(current) + len(part) > limit:
            chunks.append(current); current = part
        else:
            current += part
    if current:
        chunks.append(current)
    return chunks[:12]


def caption_layer(text, size, destination):
    width, height = size
    font = ImageFont.truetype(FONT, max(18, round(min(width, height) * .05)))
    image = Image.new("RGBA", size, (0, 0, 0, 0)); draw = ImageDraw.Draw(image)
    lines, line = [], ""
    for char in text:
        if line and draw.textlength(line + char, font=font) > width * .84:
            lines.append(line); line = char
        else:
            line += char
    if line:
        lines.append(line)
    line_height = font.size * 1.35; block = line_height * len(lines)
    top = height * .9 - block; pad = font.size * .45
    widest = max(draw.textlength(item, font=font) for item in lines)
    draw.rounded_rectangle(((width - widest) / 2 - pad, top - pad * .6, (width + widest) / 2 + pad, top + block + pad * .4), radius=pad, fill=(0, 0, 0, 150))
    for index, item in enumerate(lines):
        draw.text(((width - draw.textlength(item, font=font)) / 2, top + index * line_height), item, font=font, fill="#ffffff")
    image.save(destination, "PNG")


def camera_move(scene):
    """推拉摇移方向：优先读运镜描述，否则按镜头 ID 固定选择，保证每次导出一致。"""
    text = str(scene.get("camera", "")).lower()
    if any(word in text for word in ("拉远", "拉出", "pull", "zoom out")): return "out"
    if any(word in text for word in ("左", "left")): return "left"
    if any(word in text for word in ("右", "right")): return "right"
    if any(word in text for word in ("推", "push", "zoom in")): return "in"
    return ("in", "left", "out", "right")[sum(map(ord, str(scene.get("id", "")))) % 4]


def ken_burns(scene, width, height, frames, shade):
    move = camera_move(scene); progress = f"on/{max(1, frames - 1)}"
    zoom = {"in": f"1+0.12*{progress}", "out": f"1.12-0.12*{progress}"}.get(move, "1.12")
    x = {"left": f"(iw-iw/zoom)*{progress}", "right": f"(iw-iw/zoom)*(1-{progress})"}.get(move, "iw/2-(iw/zoom/2)")
    return (f"[0:v]scale={width * 2}:{height * 2}:force_original_aspect_ratio=increase,crop={width * 2}:{height * 2},"
            f"zoompan=z='{zoom}':x='{x}':y='ih/2-(ih/zoom/2)':d={frames}:s={width}x{height}:fps=24,setsar=1,setpts=PTS-STARTPTS{shade}[bg];")


def scene_text(scene):
    for key, limit in (("camera", 80), ("narration", 400), ("visual", 1000)):
        if not isinstance(scene.get(key, ""), str) or len(scene.get(key, "")) > limit:
            raise HTTPException(422, "Invalid scene text")
    if scene.get("source", "text") not in SOURCES or scene.get("transition", "cut") not in {"cut", "fade"}:
        raise HTTPException(422, "Invalid scene option")
    return scene.get("narration", "").strip()


def scene_captions(index, narration, duration, voice, size, directory):
    """字幕按标点分段，在旁白时长内依次显示；没有配音时按镜头时长均分。"""
    width, height = size
    chunk_limit = 2 * max(6, int(width * .84 / max(18, round(min(width, height) * .05))))
    chunks = caption_chunks(narration, chunk_limit)
    span = min(duration, voice[1]["duration"]) if voice else duration
    total = sum(len(chunk) for chunk in chunks); start = 0; captions = []
    for position, chunk in enumerate(chunks):
        path = directory / f"caption-{index}-{position}.png"; caption_layer(chunk, size, path)
        end = duration if position == len(chunks) - 1 else start + span * len(chunk) / total
        captions.append((path, round(start, 3), round(end, 3))); start = end
    return captions


def render_scene(index, scene, duration, size, media, directory, subtitles, deadline):
    width, height = size
    narration = scene_text(scene)
    text_path = directory / f"text-{index}.png"; text_layer(scene, size, text_path)
    output = directory / f"scene-{index}.mp4"
    args = ["ffmpeg", "-v", "error", "-nostdin", "-y", "-threads", "1", "-filter_complex_threads", "1"]
    asset = media.get(scene.get("assetId")); trim = number(scene.get("trimStart", 0), 0, 1800)
    volume = number(scene.get("volume", 0), 0, 1); frames = max(1, round(duration * 24))
    # 旧工程（source=text）中的图片保持静止；分镜镜头的图片做推拉摇移。
    moving = bool(asset and asset[1]["type"] == "image" and scene.get("source", "text") != "text")
    if asset and asset[1]["type"] == "image":
        args += ["-i", str(asset[0])] if moving else ["-loop", "1", "-framerate", "24", "-i", str(asset[0])]
    elif asset and asset[1]["type"] == "video":
        if trim + duration > asset[1]["duration"] + .1: raise HTTPException(422, "Trim exceeds video duration")
        args += ["-protocol_whitelist", "file,pipe", "-ss", str(trim), "-i", str(asset[0])]
    elif scene.get("assetId"):
        raise HTTPException(422, "Invalid scene media")
    else:
        args += ["-f", "lavfi", "-i", f"color=c={color(scene.get('background', '#111827'))}:s={width}x{height}:r=24"]
    args += ["-loop", "1", "-framerate", "24", "-i", str(text_path), "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
    voice = media.get(scene.get("narrationAssetId")) if scene.get("narrationAssetId") else None
    if scene.get("narrationAssetId") and (not voice or voice[1]["type"] != "audio"): raise HTTPException(422, "Invalid narration")
    if voice: args += ["-protocol_whitelist", "file,pipe", "-i", str(voice[0])]
    captions = scene_captions(index, narration, duration, voice, size, directory) if subtitles and narration else []
    for path, _, _ in captions: args += ["-loop", "1", "-framerate", "24", "-i", str(path)]
    shade = ",drawbox=x=0:y=0:w=iw:h=ih:color=black@0.333:t=fill" if asset and (scene.get("title", "").strip() or scene.get("subtitle", "").strip()) else ""
    base = ken_burns(scene, width, height, frames, shade) if moving else f"[0:v]scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},setsar=1,fps=24,setpts=PTS-STARTPTS{shade}[bg];"
    animation = scene.get("animation", "rise")
    if animation not in {"none", "fade", "rise", "zoom"}: raise HTTPException(422, "Invalid animation")
    overlay = "[1:v]format=rgba"
    if animation != "none": overlay += ",fade=t=in:st=0:d=0.5:alpha=1"
    if animation == "zoom": overlay += f",scale=w='trunc({width}*(0.94+0.06*min(t/0.5,1))/2)*2':h='trunc({height}*(0.94+0.06*min(t/0.5,1))/2)*2':eval=frame"
    overlay += "[fg];[bg][fg]overlay=x=(W-w)/2:y=" + ("'(H-h)/2+24*max(0,1-t/0.5)'" if animation == "rise" else "(H-h)/2") + ":shortest=1[vt0];"
    first_caption = 4 if voice else 3
    for position, (_, start, end) in enumerate(captions):
        overlay += f"[vt{position}][{first_caption + position}:v]overlay=x=0:y=0:eof_action=pass:enable='between(t,{start},{end})'[vt{position + 1}];"
    overlay += f"[vt{len(captions)}]format=yuv420p[v];"
    source_audio = "0:a" if asset and asset[1].get("hasAudio") and volume else "2:a"
    audio = f"[{source_audio}]atrim=duration={duration},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume={volume if source_audio == '0:a' else 0},apad"
    if voice:
        audio += f"[sa];[3:a]atrim=duration={duration},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[na];[sa][na]amix=inputs=2:duration=first:normalize=0[a]"
    else:
        audio += "[a]"
    args += ["-filter_complex", base + overlay + audio, "-map", "[v]", "-map", "[a]", "-t", str(duration), "-c:v", "libx264", "-threads", "1", "-preset", "veryfast", "-crf", "22", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(output)]
    run(args, max(1, min(150, deadline - time.monotonic())))
    return output, (min(duration, voice[1]["duration"]) if voice else 0)


def join_scenes(outputs, scenes, durations, directory, deadline):
    """全部硬切时直接拼接；存在淡入淡出时重新编码一次，交叉转场。返回成片路径、总时长和每镜起点。"""
    starts, total = [], 0
    fades = [index < len(scenes) - 1 and scenes[index].get("transition") == "fade" and min(durations[index], durations[index + 1]) >= 2 * FADE for index in range(len(scenes))]
    for index, duration in enumerate(durations):
        starts.append(total); total += duration - (FADE if fades[index] else 0)
    joined = directory / "joined.mp4"
    if not any(fades):
        concat = directory / "concat.txt"; concat.write_text("".join(f"file '{path.name}'\n" for path in outputs), encoding="utf-8")
        run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-f", "concat", "-safe", "1", "-i", str(concat), "-c", "copy", "-movflags", "+faststart", str(joined)], 30)
        return joined, total, starts
    args = ["ffmpeg", "-v", "error", "-nostdin", "-y", "-threads", "1", "-filter_complex_threads", "1"]
    for path in outputs: args += ["-i", str(path)]
    graph = "".join(f"[{i}:v]settb=AVTB,fps=24,format=yuv420p,setpts=PTS-STARTPTS[v{i}];[{i}:a]aresample=48000,asetpts=PTS-STARTPTS[a{i}];" for i in range(len(outputs)))
    video, audio, elapsed = "v0", "a0", durations[0]
    for i in range(1, len(outputs)):
        if fades[i - 1]:
            graph += f"[{video}][v{i}]xfade=transition=fade:duration={FADE}:offset={round(elapsed - FADE, 3)}[x{i}];[{audio}][a{i}]acrossfade=d={FADE}[y{i}];"
            elapsed += durations[i] - FADE
        else:
            graph += f"[{video}][{audio}][v{i}][a{i}]concat=n=2:v=1:a=1[x{i}][y{i}];"
            elapsed += durations[i]
        video, audio = f"x{i}", f"y{i}"
    args += ["-filter_complex", graph.rstrip(";"), "-map", f"[{video}]", "-map", f"[{audio}]", "-c:v", "libx264", "-threads", "1", "-preset", "veryfast", "-crf", "22", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(joined)]
    run(args, max(1, min(240, deadline - time.monotonic())))
    return joined, total, starts


def render(composition, media, directory):
    size = SIZES.get(composition.get("ratio")); scenes = composition.get("scenes")
    if not size or not isinstance(scenes, list) or not 1 <= len(scenes) <= 40 or not all(isinstance(scene, dict) for scene in scenes): raise HTTPException(422, "Invalid composition")
    durations = [number(s.get("duration"), 1, 30) for s in scenes]
    if sum(durations) > 180: raise HTTPException(422, "Video exceeds 180 seconds")
    deadline = time.monotonic() + 480; subtitles = composition.get("subtitles", True) is not False
    outputs, spoken = [], []
    for index, (scene, duration) in enumerate(zip(scenes, durations)):
        output, voice_duration = render_scene(index, scene, duration, size, media, directory, subtitles, deadline)
        outputs.append(output); spoken.append(voice_duration)
    joined, total, starts = join_scenes(outputs, scenes, durations, directory, deadline)
    track = composition.get("audio")
    if track:
        asset = media.get(track.get("assetId"))
        if not asset or asset[1]["type"] != "audio": raise HTTPException(422, "Invalid soundtrack")
        volume = number(track.get("volume", .5), 0, 1); trim = number(track.get("trimStart", 0), 0, asset[1]["duration"])
        if trim >= asset[1]["duration"]: raise HTTPException(422, "Soundtrack trim exceeds duration")
        # 有旁白的时段自动压低配乐，旁白结束后恢复；片尾 1.5 秒淡出。
        talking = "+".join(f"between(t,{round(starts[i], 3)},{round(starts[i] + spoken[i], 3)})" for i in range(len(scenes)) if spoken[i] > 0)
        duck = f",volume=0.25:enable='{talking}'" if talking else ""
        fade_out = f",afade=t=out:st={max(0, round(total - 1.5, 3))}:d=1.5"
        final = directory / "final.mp4"
        run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-i", str(joined), "-protocol_whitelist", "file,pipe", "-ss", str(trim), "-i", str(asset[0]), "-filter_complex_threads", "1", "-filter_complex", f"[1:a]volume={volume}{duck}{fade_out},apad[m];[0:a][m]amix=inputs=2:duration=first:normalize=0[a]", "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-t", str(round(total, 3)), "-movflags", "+faststart", str(final)], 60)
        joined = final
    if joined.stat().st_size > 128 * 1024 * 1024: raise HTTPException(413, "Output too large")
    return joined.read_bytes()
