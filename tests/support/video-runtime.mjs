import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

// CI-only test infrastructure: production media inspection/rendering, with no
// model engines or external supplier. The fixture contains changing frames.
export async function startVideoRuntime() {
  const directory = await mkdtemp(join(tmpdir(), "modelshot-video-e2e-"));
  const file = join(directory, "source.mp4");
  let service;
  try {
    await promisify(execFile)("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=12", "-t", "4", "-an", "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", "-movflags", "+faststart", file], { timeout: 20000 });
    const bytes = await readFile(file);
    const port = Number(process.env.TEST_MEDIA_PORT || 3200), baseURL = `http://127.0.0.1:${port}`;
    service = spawn(process.env.PYTHON || "python", ["-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", String(port), "--workers", "1"], {
      cwd: "services/image-tools", stdio: "inherit", env: { ...process.env, TOOLS_CONCURRENCY: "1", REMBG_ENABLED: "0", OCR_ENABLED: "0", REALESRGAN_BIN: "", REALESRGAN_MODELS: "" },
    });
    let startupError;
    service.on("error", error => { startupError = error; });
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      if (startupError) throw startupError;
      if (service.exitCode !== null) throw new Error("Media service exited during startup");
      try {
        const response = await fetch(`${baseURL}/capabilities`, { headers: { Authorization: `Bearer ${process.env.STUDIO_TOOLS_KEY}` }, signal: AbortSignal.timeout(1000) });
        if (response.ok && (await response.json()).tools.includes("motion-render")) { ready = true; break; }
      } catch { /* The bounded startup probe retries until uvicorn is listening. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error("Real media service did not become ready");
    return { bytes, baseURL, async stop() { service.kill(); await rm(directory, { recursive: true, force: true }); } };
  } catch (error) {
    service?.kill();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
