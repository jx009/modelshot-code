import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { AppError } from "../../http.js";
import { REFERENCE_CONTEXT_BYTES, REFERENCE_OFFICE_BYTES, REFERENCE_READER_VERSION } from "../../creation/reference-policy.js";

function childProcess(root, signal, timeoutMs) {
  return new Promise((resolve, reject) => {
    const env = Object.fromEntries(["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL"].filter(key => process.env[key]).map(key => [key, process.env[key]]));
    const child = spawn(process.execPath, ["--max-old-space-size=192", fileURLToPath(new URL("../../creation/references/office-child.mjs", import.meta.url)), root], { stdio: "ignore", windowsHide: true, env });
    let stopped = false;
    const stop = () => { stopped = true; child.kill("SIGKILL"); };
    const timer = setTimeout(stop, timeoutMs);
    signal.addEventListener("abort", stop, { once: true }); if (signal.aborted) stop();
    child.once("error", error => { clearTimeout(timer); signal.removeEventListener("abort", stop); reject(error); });
    child.once("close", async code => {
      clearTimeout(timer); signal.removeEventListener("abort", stop);
      if (stopped) { reject(new AppError(signal.aborted ? "CREATION_REFERENCE_CANCELLED" : "CREATION_REFERENCE_EXTRACT_TIMEOUT", 422)); return; }
      if (code === 0) { resolve(); return; }
      let failure = "CREATION_REFERENCE_EXTRACT_FAILED";
      try {
        if ((await stat(join(root, "error.json"))).size < 1024) {
          const result = JSON.parse(await readFile(join(root, "error.json"), "utf8"));
          if (/^CREATION_REFERENCE_[A-Z_]+$/.test(result.code)) failure = result.code;
        }
      } catch { /* A killed child may have no diagnostic file. */ }
      reject(new AppError(failure, 422));
    });
  });
}

export async function extractReferenceInProcess(bytes, fileType, { signal = new AbortController().signal, timeoutMs = 20000 } = {}) {
  if (process.env.CREATION_REFERENCE_ISOLATED !== "true") throw new AppError("CREATION_REFERENCE_READER_UNAVAILABLE", 503);
  signal.throwIfAborted();
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > REFERENCE_OFFICE_BYTES) throw new AppError("CREATION_REFERENCE_INVALID", 422);
  const root = await mkdtemp(join(tmpdir(), "modelshot-reference-"));
  try {
    await writeFile(join(root, "source.bin"), bytes);
    await writeFile(join(root, "input.json"), JSON.stringify({ version: REFERENCE_READER_VERSION, fileType, bytes: bytes.length, checksum: createHash("sha256").update(bytes).digest("hex") }));
    signal.throwIfAborted();
    await childProcess(root, signal, Math.min(20000, Math.max(1, timeoutMs)));
    signal.throwIfAborted();
    const output = join(root, "output.json"), size = (await stat(output)).size;
    if (size < 1 || size > REFERENCE_CONTEXT_BYTES) throw new AppError("CREATION_REFERENCE_CONTEXT_LIMIT", 413);
    const result = JSON.parse(await readFile(output, "utf8"));
    if (result.readerVersion !== REFERENCE_READER_VERSION || typeof result.text !== "string" || !Array.isArray(result.limitations) || result.limitations.some(value => typeof value !== "string")) throw new AppError("CREATION_REFERENCE_INVALID", 422);
    return result;
  } finally {
    // Exact unique mkdtemp result; never derived from a user filename. The
    // child has exited before removing this directory and its two bounded files.
    await rm(root, { recursive: true, force: true });
  }
}
