import { createImageQueue } from "./image-queue.js";
const queueImage = createImageQueue(4);

export function assetImageRequest(src, delivery) {
  if (typeof src !== "string" || !/^\/api\/assets\/[a-zA-Z0-9_-]+(?:\?|$)/.test(src)) return src;
  const [path, query = ""] = src.split("?");
  const params = new URLSearchParams(query);
  params.set("delivery", delivery);
  return `${path}?${params}`;
}
/**
 * Process large images to prevent memory issues
 * @param {HTMLImageElement} image - Source image
 * @param {number} maxDimension - Maximum width or height
 * @returns {Promise<HTMLImageElement>} Processed image
 */
export async function processLargeImage(image, maxDimension = 2048) {
  const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
  if (width <= maxDimension && height <= maxDimension) {
    return image;
  }

  const scale = maxDimension / Math.max(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);

  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.src = URL.createObjectURL(blob);
    });
  });
}

/**
 * Load image with error handling
 * @param {string} src - Image source URL
 * @returns {Promise<HTMLImageElement>} Loaded image
 */
const images = new Map();
// Return decoded pixels without starting another request (including a signed redirect).
export function getCachedImage(src) {
  const entry = images.get(src);
  if (!entry?.image) return null;
  images.delete(src);
  images.set(src, entry);
  return entry.image;
}
function trimImages() {
  for (const [key, entry] of images) {
    if (images.size <= 32) break;
    if (entry.settled) images.delete(key);
  }
}
export function loadImage(src, { signal, timeoutMs = 25000 } = {}) {
  if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  if (!images.has(src)) {
    const controller = new AbortController();
    const entry = { controller, consumers: 0, settled: false };
    const task = queueImage(() => new Promise((resolve, reject) => {
      let attempt = 0;
      function start() {
        if (controller.signal.aborted) { reject(controller.signal.reason); return; }
        const image = new window.Image();
        image.decoding = "async";
        // COS responses must be CORS-readable before drawing to/exporting canvas.
        if (typeof src === "string" && src.startsWith("/api/assets/")) image.crossOrigin = "anonymous";
        let settled = false;
        const timer = setTimeout(() => fail("IMAGE_LOAD_TIMEOUT"), timeoutMs);
        const cleanup = () => { clearTimeout(timer); image.onload = null; image.onerror = null; controller.signal.removeEventListener("abort", abort); };
        function abort() {
          if (settled) return;
          settled = true; cleanup(); image.src = ""; reject(controller.signal.reason);
        }
        function fail(code) {
          if (settled) return;
          settled = true;
          cleanup(); image.src = "";
          if (++attempt < 2) start(); else reject(new Error(code));
        }
        image.onload = async () => {
          try {
            if (typeof image.decode === "function") await image.decode();
            if (settled) return;
            if (!image.naturalWidth) { fail("IMAGE_LOAD_FAILED"); return; }
            settled = true; cleanup(); resolve(image);
          } catch { fail("IMAGE_LOAD_FAILED"); }
        };
        image.onerror = () => fail("IMAGE_LOAD_FAILED");
        controller.signal.addEventListener("abort", abort, { once: true });
        // An expired/deleted replica or missing bucket CORS falls back to MinIO.
        image.src = assetImageRequest(src, attempt ? "proxy" : "auto");
      }
      start();
    }), controller.signal);
    entry.task = task;
    images.set(src, entry);
    task.then(image => { entry.image = image; entry.settled = true; trimImages(); }, () => { entry.settled = true; if (images.get(src) === entry) images.delete(src); });
  }
  const entry = images.get(src);
  // A shared download remains alive while any canvas/export still needs it.
  // Leaving the last consumer cancels the underlying image, not just its waiter.
  entry.consumers++;
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (callback, value) => {
      if (finished) return;
      finished = true; signal?.removeEventListener("abort", abort);
      entry.consumers--;
      if (!entry.consumers && !entry.settled) {
        if (images.get(src) === entry) images.delete(src);
        entry.controller.abort();
      }
      callback(value);
    };
    const abort = () => finish(reject, new DOMException("Aborted", "AbortError"));
    signal?.addEventListener("abort", abort, { once: true });
    entry.task.then(value => finish(resolve, value), error => finish(reject, error));
  });
}

/**
 * Create alpha mask blob from image
 * @param {HTMLImageElement} image - Source image
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 * @returns {Promise<{mask: Blob, bounds: Object}>} Mask blob and bounds
 */
export async function alphaMaskBlob(image, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height);

  let left = width, top = height, right = 0, bottom = 0;

  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    const selected = pixels.data[offset + 3];
    if (selected > 16) {
      const x = (offset / 4) % width;
      const y = Math.floor(offset / 4 / width);
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x + 1);
      bottom = Math.max(bottom, y + 1);
    }
    pixels.data[offset] = selected;
    pixels.data[offset + 1] = selected;
    pixels.data[offset + 2] = selected;
    pixels.data[offset + 3] = 255;
  }

  if (right === 0 || bottom === 0) throw new Error("EMPTY_MASK");

  context.putImageData(pixels, 0, 0);

  return {
    mask: await new Promise((resolve) => canvas.toBlob(resolve, "image/png")),
    bounds: { left, top, width: right - left, height: bottom - top },
  };
}
