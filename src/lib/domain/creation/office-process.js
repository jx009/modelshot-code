import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { AppError } from "../../http.js";

export async function importOfficeInProcess(bytes, options, { signal = new AbortController().signal, timeoutMs = 30000 } = {}) {
  if (process.env.CREATION_EXPORT_ISOLATED !== "true") throw new AppError("OFFICE_WORKER_UNAVAILABLE", 503);
  if (!Buffer.isBuffer(bytes) || bytes.length < 22 || bytes.length > 4 * 1024 * 1024) throw new AppError("OFFICE_SOURCE_INVALID", 422);
  signal.throwIfAborted();
  const root = await mkdtemp(join(tmpdir(), "modelshot-office-import-"));
  try {
    await writeFile(join(root, "source.bin"), bytes);
    await writeFile(join(root, "input.json"), JSON.stringify({ ...options, bytes: bytes.length, checksum: createHash("sha256").update(bytes).digest("hex") }));
    await new Promise((resolve, reject) => {
      const env = Object.fromEntries(["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL"].filter(key => process.env[key]).map(key => [key, process.env[key]]));
      const child = spawn(process.execPath, ["--max-old-space-size=192", fileURLToPath(new URL("../../creation/office/import-child.mjs", import.meta.url)), root], { stdio: "ignore", windowsHide: true, env });
      let stopped = false;
      const stop = () => { stopped = true; child.kill("SIGKILL"); };
      const timer = setTimeout(stop, Math.min(30000, Math.max(1, timeoutMs)));
      signal.addEventListener("abort", stop, { once: true }); if (signal.aborted) stop();
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", stop); };
      child.once("error", error => { cleanup(); reject(error); });
      child.once("close", async code => {
        cleanup();
        if (stopped) { reject(new AppError(signal.aborted ? "OFFICE_IMPORT_CANCELLED" : "OFFICE_IMPORT_TIMEOUT", 422)); return; }
        if (code === 0) { resolve(); return; }
        let failure = "OFFICE_IMPORT_FAILED";
        try {
          if ((await stat(join(root, "error.json"))).size < 1024) {
            const info = JSON.parse(await readFile(join(root, "error.json"), "utf8"));
            if (/^(?:OFFICE_|CREATION_REFERENCE_|NATIVE_OFFICE_)[A-Z0-9_]+$/.test(info.code)) failure = info.code;
          }
        } catch { /* Crashed child has no diagnostic. */ }
        reject(new AppError(failure, 422));
      });
    });
    signal.throwIfAborted();
    if ((await stat(join(root, "output.json"))).size > 2 * 1024 * 1024 + 16384) throw new AppError("OFFICE_OUTPUT_LIMIT", 422);
    const output = JSON.parse(await readFile(join(root, "output.json"), "utf8"));
    if (output.version !== "office-import-2" || !Array.isArray(output.media) || output.media.length > 16) throw new AppError("OFFICE_OUTPUT_INVALID", 422);
    let mediaBytes = 0;
    for (const [index, item] of output.media.entries()) {
      if (!Number.isInteger(item.bytes) || item.bytes < 1 || item.bytes > 32 * 1024 * 1024 || (await stat(join(root, "media-" + index))).size !== item.bytes) throw new AppError("OFFICE_OUTPUT_INVALID", 422);
      mediaBytes += item.bytes;
      if (mediaBytes > 32 * 1024 * 1024 || !Number.isSafeInteger(item.width) || !Number.isSafeInteger(item.height) || item.width < 1 || item.height < 1 || item.width * item.height > 16000000) throw new AppError("OFFICE_OUTPUT_INVALID", 422);
      item.data = await readFile(join(root, "media-" + index));
      if (createHash("sha256").update(item.data).digest("hex") !== item.checksum) throw new AppError("OFFICE_OUTPUT_INVALID", 422);
    }
    return output;
  } finally {
    // Exactly the fresh mkdtemp path; no user-controlled deletion target.
    await rm(root, { recursive: true, force: true });
  }
}
