"""Private CPU/GPU tool service. Models are optional; capabilities reflect loaded engines."""
import asyncio
import hmac
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import Response
from PIL import Image, UnidentifiedImageError

Image.MAX_IMAGE_PIXELS = 40_000_000
MAX_BYTES = 10 * 1024 * 1024
ENGINES = {}
LOCK = asyncio.Semaphore(1)


@asynccontextmanager
async def lifespan(_app):
    if len(os.environ.get("STUDIO_TOOLS_KEY", "")) < 24:
        raise RuntimeError("STUDIO_TOOLS_KEY must contain at least 24 characters")
    if os.environ.get("REMBG_ENABLED") == "1":
        from rembg import new_session, remove
        ENGINES["remove-bg"] = (remove, new_session(os.environ.get("REMBG_MODEL", "u2net")))
    if os.environ.get("OCR_ENABLED") == "1":
        from paddleocr import PaddleOCR
        ENGINES["ocr"] = PaddleOCR(use_angle_cls=True, lang=os.environ.get("OCR_LANGUAGE", "ch"), show_log=False)
    binary = os.environ.get("REALESRGAN_BIN")
    models = os.environ.get("REALESRGAN_MODELS")
    model_name = os.environ.get("REALESRGAN_MODEL", "realesr-animevideov3")
    if binary and models:
        executable, directory = Path(binary).resolve(), Path(models).resolve()
        if not executable.is_file() or not directory.is_dir() or not all((directory / f"{model_name}-x{s}.bin").is_file() and (directory / f"{model_name}-x{s}.param").is_file() for s in (2, 4)):
            raise RuntimeError("Real-ESRGAN executable and x2/x4 model files must exist")
        ENGINES["upscale"] = (str(executable), str(directory), model_name)
    yield
    ENGINES.clear()


app = FastAPI(title="ModelShot private image tools", lifespan=lifespan)


def authorize(authorization: str = Header(default="")):
    expected = os.environ.get("STUDIO_TOOLS_KEY", "")
    if not expected or not hmac.compare_digest(authorization, f"Bearer {expected}"):
        raise HTTPException(401, "Unauthorized")


@app.get("/capabilities", dependencies=[Depends(authorize)])
async def capabilities():
    return {"version": 1, "tools": list(ENGINES)}


def decode(data):
    try:
        source = Image.open(io.BytesIO(data))
        if source.format not in ("PNG", "JPEG", "WEBP") or source.width * source.height > 40_000_000:
            raise HTTPException(413, "Image too large")
        source.load()
        return source.convert("RGBA")
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError) as exc:
        raise HTTPException(422, "Invalid image") from exc


def process(tool, data, params):
    source = decode(data)
    if tool == "remove-bg":
        remove, session = ENGINES[tool]
        result = remove(source, session=session)
    elif tool == "upscale":
        scale = params.get("scale", 2)
        if scale not in (2, 4) or max(source.size) * scale > 8192 or source.width * source.height * scale * scale > 40_000_000:
            raise HTTPException(413, "Invalid output size")
        binary, models, model = ENGINES[tool]
        with tempfile.TemporaryDirectory(prefix="modelshot-upscale-") as directory:
            path = Path(directory)
            source.convert("RGB").save(path / "input.png")
            # No shell, user filenames or free-form process arguments are allowed.
            try:
                subprocess.run([binary, "-i", str(path / "input.png"), "-o", str(path / "output.png"), "-m", models, "-n", model, "-s", str(scale), "-t", "256", "-f", "png"], check=True, timeout=150, capture_output=True)
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
                raise HTTPException(502, "Upscaler failed") from exc
            result = Image.open(path / "output.png").convert("RGBA")
            result.load()
            if result.size != (source.width * scale, source.height * scale):
                raise HTTPException(502, "Upscaler returned wrong dimensions")
            result.putalpha(source.getchannel("A").resize(result.size, Image.Resampling.LANCZOS))
    elif tool == "ocr":
        import numpy as np
        rows = ENGINES[tool].ocr(np.asarray(source.convert("RGB"))[:, :, ::-1], cls=True)
        boxes = []
        for row in (rows[0] or [])[:100]:
            points, (text, score) = row
            left = max(0, int(min(p[0] for p in points)))
            top = max(0, int(min(p[1] for p in points)))
            right = min(source.width, int(max(p[0] for p in points)))
            bottom = min(source.height, int(max(p[1] for p in points)))
            if right > left and bottom > top:
                boxes.append({"text": text[:2000], "confidence": float(score), "rect": {"left": left, "top": top, "width": right - left, "height": bottom - top}})
        return {"boxes": boxes, "width": source.width, "height": source.height}
    else:
        raise HTTPException(404, "Tool unavailable")
    output = io.BytesIO()
    result.save(output, "PNG")
    if output.tell() > MAX_BYTES:
        raise HTTPException(413, "Output exceeds asset storage limit")
    return output.getvalue()


@app.post("/tools/{tool}", dependencies=[Depends(authorize)])
async def execute(tool: str, image: UploadFile = File(...), params: str = Form("{}")):
    if tool not in ENGINES:
        raise HTTPException(503, "Tool is not configured")
    data = await image.read(MAX_BYTES + 1)
    await image.close()
    if len(data) > MAX_BYTES or len(params) > 8192:
        raise HTTPException(413, "Payload too large")
    try:
        options = json.loads(params)
        if not isinstance(options, dict):
            raise ValueError()
    except (ValueError, TypeError) as exc:
        raise HTTPException(422, "Invalid parameters") from exc
    async with LOCK:
        result = await asyncio.to_thread(process, tool, data, options)
    return result if isinstance(result, dict) else Response(result, media_type="image/png")
