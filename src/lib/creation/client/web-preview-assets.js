const MAX_IMAGE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 6 * 1024 * 1024;
const validId = id => typeof id === "string" && /^[a-zA-Z0-9_-]{16,64}$/.test(id);
const fail = code => { throw new Error(code); };

async function readImage(response, signal) {
  if (!response.ok || response.redirected) fail("WEB_PREVIEW_ASSET_UNAVAILABLE");
  if (response.headers.get("content-type")?.split(";", 1)[0] !== "image/webp") fail("WEB_PREVIEW_ASSET_TYPE");
  const length = Number(response.headers.get("content-length"));
  if (length > MAX_IMAGE_BYTES) { await response.body?.cancel(); fail("WEB_PREVIEW_ASSET_LIMIT"); }
  if (!response.body) fail("WEB_PREVIEW_ASSET_UNAVAILABLE");
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES) fail("WEB_PREVIEW_ASSET_LIMIT");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  if (!size) fail("WEB_PREVIEW_ASSET_TYPE");
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  // Only accept the server's raster derivative, not mislabeled HTML or SVG.
  if (size < 12 || String.fromCharCode(...bytes.subarray(0, 4)) !== "RIFF" || String.fromCharCode(...bytes.subarray(8, 12)) !== "WEBP") fail("WEB_PREVIEW_ASSET_TYPE");
  return bytes;
}
function dataUrl(bytes) {
  const parts = [];
  for (let start = 0; start < bytes.length; start += 8192) parts.push(String.fromCharCode(...bytes.subarray(start, start + 8192)));
  return `data:image/webp;base64,${btoa(parts.join(""))}`;
}

// Per-preview lifetime, no global user-data cache. At most two derivative
// requests, with a shared aggregate bound and cancellation on supersession.
export async function loadWebPreviewAssets(ids, { signal, fetcher = fetch, onImage } = {}) {
  const selected = [...new Set(ids)];
  if (selected.length > 20 || selected.some(id => !validId(id))) fail("WEB_PREVIEW_ASSET_LIMIT");
  const controller = new AbortController(), cancel = () => controller.abort(signal.reason);
  if (signal?.aborted) cancel(); else signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("WEB_PREVIEW_ASSET_TIMEOUT")), 15000);
  const images = new Map(); let cursor = 0, bytes = 0, failure;
  async function worker() {
    try {
      while (cursor < selected.length) {
        controller.signal.throwIfAborted();
        const id = selected[cursor++];
        // Force same-origin proxy delivery. no-store prevents another account
        // in this browser from reusing an authenticated private HTTP cache hit.
        const response = await fetcher(`/api/assets/${encodeURIComponent(id)}?preview=1280&delivery=proxy`, {
          signal: controller.signal, credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
        });
        const image = await readImage(response, controller.signal);
        bytes += image.byteLength; if (bytes > MAX_TOTAL_BYTES) fail("WEB_PREVIEW_ASSET_LIMIT");
        controller.signal.throwIfAborted();
        const url = dataUrl(image);
        images.set(id, url); onImage?.(id, url);
      }
    } catch (error) { failure ||= error; controller.abort(error); }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(2, selected.length) }, worker));
    if (failure) throw failure;
    controller.signal.throwIfAborted();
    return images;
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", cancel); }
}

// Owned by one mounted editor, never shared between users/artifacts. Keep only
// the current page's assets, with the same decoded-byte budget as a cold load.
export function createWebPreviewAssetLoader() {
  const cache = new Map();
  return async (ids, options = {}) => {
    const selected = [...new Set(ids)];
    if (selected.length > 20 || selected.some(id => !validId(id))) fail("WEB_PREVIEW_ASSET_LIMIT");
    for (const id of cache.keys()) if (!selected.includes(id)) cache.delete(id);
    const sizeOf = url => {
      const base64 = url.slice(url.indexOf(",") + 1);
      return base64.length * 3 / 4 - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
    };
    let bytes = [...cache.values()].reduce((sum, url) => sum + sizeOf(url), 0);
    for (const [id, url] of cache) options.onImage?.(id, url);
    await loadWebPreviewAssets(selected.filter(id => !cache.has(id)), { ...options, onImage(id, url) {
      options.signal?.throwIfAborted();
      bytes += sizeOf(url);
      if (bytes > MAX_TOTAL_BYTES) fail("WEB_PREVIEW_ASSET_LIMIT");
      cache.set(id, url); options.onImage?.(id, url);
    } });
    return new Map(cache);
  };
}
