# Private image tools

Independent implementation; no ai-picture-editor source is included. This service must stay on a private interface behind the authenticated Next.js application. It is optional: the UI reports unavailable capabilities when it is absent.

Use Python 3.11 in a separate virtual environment. Install `requirements.txt`, then the engines you need:

- Background removal: `pip install "rembg[cpu]==2.0.67"`; set `REMBG_ENABLED=1`. The private service only provides one-click background removal. Configure Volcengine EntitySegment in the administrator's tool model settings for object selection; moving and local editing request it when the user draws a selection. `REMBG_MODEL` defaults to u2net. Provision its weights during the image build for offline startup.
- OCR: `pip install "paddleocr==2.10.0" "paddlepaddle==2.6.2"`; set `OCR_ENABLED=1`. The v2 API is deliberately pinned. Set `OCR_LANGUAGE=ch` for Chinese/English mixed text. Windows installations may require a separately supported Paddle wheel; Linux is recommended for deployment.
- Super resolution: install the official [Real-ESRGAN ncnn Vulkan](https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan) distribution. Set `REALESRGAN_BIN` to the executable and `REALESRGAN_MODELS` to its models directory. The default `realesr-animevideov3` package contains x2/x4 models; it is aimed at illustrated content. Validate a photo-appropriate model before enabling for photographic products. Model file existence is checked at startup, actual GPU execution must also be smoke-tested. No weight files or binaries are bundled.

Set a random `STUDIO_TOOLS_KEY` of at least 24 characters in both services. Start from this folder:

```powershell
python -m uvicorn app:app --host 127.0.0.1 --port 8090 --workers 1
```

In Next.js/worker set `STUDIO_TOOLS_URL=http://127.0.0.1:8090` and the matching key. Configuration changes require restart. `/capabilities` returns only loaded engines. The Node worker additionally verifies true x2/x4 dimensions and input/output byte and pixel limits. `TOOLS_CONCURRENCY` defaults to two in-process image requests and is capped at four; keep one Uvicorn process so models and embeddings remain shared. On an 8-core host that also runs the app and database, start with two slots and two inference threads, then raise concurrency only after measuring latency, CPU and memory. Put an upstream request size limit (11 MB) on the service if deployed across machines.

Code licenses: rembg MIT; Real-ESRGAN BSD-3-Clause; PaddleOCR Apache-2.0. Weight licenses, provenance and suitability are separate checks. A code license alone is not approval to commercialize every model checkpoint.
