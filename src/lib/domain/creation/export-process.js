import { spawn } from "node:child_process";
import { mkdtemp, open, readFile, writeFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { exportFormat, EXPORT_MAX_BYTES } from "../../creation/contracts/exports.js";
import { AppError } from "../../http.js";

async function copyAsset(asset, destination, store, signal) {
  const reader = (await store.stream(asset.objectKey, undefined, signal)).getReader();
  const file = await open(destination, "wx"), hash = createHash("sha256");
  let size = 0;
  const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > asset.bytes) throw new AppError("EXPORT_ASSET_INTEGRITY_FAILED", 422);
      hash.update(value); await file.writeFile(value);
    }
    if (size !== asset.bytes || hash.digest("hex") !== asset.checksum) throw new AppError("EXPORT_ASSET_INTEGRITY_FAILED", 422);
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {}); reader.releaseLock(); await file.close();
  }
}
function runChild(root, signal) {
  return new Promise((resolve, reject) => {
    // Explicit allowlist: no DB URLs, storage keys, model keys or NODE_OPTIONS.
    const env = Object.fromEntries(["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL", "PLAYWRIGHT_BROWSERS_PATH"].filter(key => process.env[key]).map(key => [key, process.env[key]]));
    env.SKIA_CANVAS_THREADS = "1";
    const child = spawn(process.execPath, ["--max-old-space-size=256", fileURLToPath(new URL("../../creation/exports/layout-child.mjs", import.meta.url)), root], { stdio: "ignore", windowsHide: true, detached: process.platform !== "win32", env });
    let stopped = false, treeStopped = Promise.resolve();
    const stop = () => {
      if (stopped) return;
      stopped = true;
      // Chromium is a grandchild. Killing only Node leaks renderers after a
      // cancellation/timeout and can leave private temporary assets locked.
      if (process.platform === "win32" && child.pid) treeStopped = new Promise(resolve => {
        const killer = spawn(join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"), ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
        killer.once("error", () => { child.kill("SIGKILL"); resolve(); });
        killer.once("close", () => { child.kill("SIGKILL"); resolve(); });
      });
      else { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }
    };
    const timer = setTimeout(stop, 120000);
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
    child.once("error", error => { clearTimeout(timer); signal.removeEventListener("abort", stop); reject(error); });
    child.once("close", async code => {
      clearTimeout(timer); signal.removeEventListener("abort", stop);
      if (stopped) { await treeStopped; reject(new AppError(signal.aborted ? "EXPORT_CANCELLED" : "EXPORT_RENDER_TIMEOUT", 422)); return; }
      if (code === 0) { resolve(); return; }
      let failure = "EXPORT_RENDER_FAILED";
      try { const info = JSON.parse(await readFile(join(root, "error.json"), "utf8")); if (/^EXPORT_[A-Z_]+$/.test(info.code)) failure = info.code; } catch { /* No child error file on a crash. */ }
      reject(new AppError(failure, 422));
    });
  });
}
export async function renderLayoutInProcess(document, assets, { store, signal, format, exporterVersion, original }) {
  if (!exportFormat(format)) throw new AppError("EXPORT_FORMAT_UNSUPPORTED", 422);
  const root = await mkdtemp(join(tmpdir(), "modelshot-export-"));
  try {
    const downloadSignal = AbortSignal.any([signal, AbortSignal.timeout(120000)]);
    if (original) {
      if (!Number.isSafeInteger(original.bytes) || original.bytes < 22 || original.bytes > 4 * 1024 * 1024) throw new AppError("EXPORT_SOURCE_INTEGRITY_FAILED", 422);
      await copyAsset(original, join(root, "original.bin"), store, downloadSignal);
    }
    for (let index = 0; index < assets.length; index++) await copyAsset(assets[index], join(root, `asset-${index}`), store, downloadSignal);
    const metadata = assets.map(({ id, bytes, checksum }) => ({ id, bytes, checksum }));
    await writeFile(join(root, "input.json"), JSON.stringify({ document, assets: metadata, format, exporterVersion, ...(original ? { original: { bytes: original.bytes, checksum: original.checksum } } : {}) }));
    signal.throwIfAborted();
    await runChild(root, signal);
    signal.throwIfAborted();
    const output = join(root, "output.bin"), info = await stat(output);
    if (info.size <= 0 || info.size > EXPORT_MAX_BYTES) throw new AppError("EXPORT_RESULT_TOO_LARGE", 413);
    return await readFile(output);
  } finally {
    // root is exactly the unique directory returned by mkdtemp above, never a
    // path from request/source data. Children have exited before recursive cleanup.
    await rm(root, { recursive: true, force: true });
  }
}

export async function probeRasterInProcess({ pdf = false, html = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "modelshot-export-probe-"));
  try {
    await writeFile(join(root, "input.json"), JSON.stringify(html ? { probeHtml: true } : pdf ? { probePdf: true } : { probeRaster: true }));
    await runChild(root, AbortSignal.timeout(15000));
  } finally { await rm(root, { recursive: true, force: true }); }
}
