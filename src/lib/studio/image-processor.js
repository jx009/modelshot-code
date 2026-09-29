/**
 * Process large images to prevent memory issues
 * @param {HTMLImageElement} image - Source image
 * @param {number} maxDimension - Maximum width or height
 * @returns {Promise<HTMLImageElement>} Processed image
 */
export async function processLargeImage(image, maxDimension = 2048) {
  if (image.width <= maxDimension && image.height <= maxDimension) {
    return image;
  }

  const scale = maxDimension / Math.max(image.width, image.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);

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
export function loadImage(src, { signal, timeoutMs = 25000 } = {}) {
  if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  if (!images.has(src)) {
    const task = new Promise((resolve, reject) => {
      let attempt = 0;
      function start() {
        const image = new window.Image();
        const timer = setTimeout(() => fail("IMAGE_LOAD_TIMEOUT"), timeoutMs);
        const cleanup = () => { clearTimeout(timer); image.onload = null; image.onerror = null; };
        function fail(code) {
          cleanup(); image.src = "";
          if (++attempt < 2) start(); else reject(new Error(code));
        }
        image.onload = () => { cleanup(); if (image.naturalWidth) resolve(image); else reject(new Error("IMAGE_LOAD_FAILED")); };
        image.onerror = () => fail("IMAGE_LOAD_FAILED");
        image.src = src;
      }
      start();
    });
    images.set(src, task);
    task.catch(() => { if (images.get(src) === task) images.delete(src); });
    while (images.size > 32) images.delete(images.keys().next().value);
  }
  const task = images.get(src);
  if (!signal) return task;
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    task.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
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
