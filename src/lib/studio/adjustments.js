// Shared pixel transform: preview and original-resolution export use the same math.
export const ADJUSTMENT_KEYS = ["exposure", "contrast", "highlights", "shadows", "temperature", "tint", "saturation", "vibrance", "fade", "vignette"];
export const ADJUSTMENT_PRESETS = [
  { id: "original", zh: "原色", en: "Original", values: {} },
  { id: "warm", zh: "暖日", en: "Warm daylight", values: { exposure: 8, temperature: 18, contrast: 8, shadows: 12 } },
  { id: "film", zh: "胶片", en: "Film", values: { contrast: 12, saturation: -15, fade: 15, temperature: 8, vignette: 20 } },
  { id: "cool", zh: "冷调", en: "Cool", values: { temperature: -20, tint: 6, contrast: 10, saturation: -8 } },
  { id: "mono", zh: "黑白", en: "Monochrome", values: { saturation: -100, contrast: 20, highlights: -12 } },
];
export const hasAdjustments = values => ADJUSTMENT_KEYS.some(key => Number(values?.[key] || 0) !== 0);
const clamp = value => Math.min(255, Math.max(0, value));
export function adjustPixels(pixels, width, height, values = {}) {
  const value = key => Math.min(100, Math.max(-100, Number(values[key]) || 0)) / 100;
  const exposure = 2 ** (value("exposure") * 2), contrast = 1 + value("contrast"), saturation = 1 + value("saturation");
  const warmth = value("temperature") * 28, tint = value("tint") * 20;
  const highlights = value("highlights") * 70, shadows = value("shadows") * 70, fade = value("fade") * 45;
  const vibrance = value("vibrance"), vignette = value("vignette");
  for (let i = 0; i < pixels.length; i += 4) {
    let r = pixels[i] * exposure, g = pixels[i + 1] * exposure, b = pixels[i + 2] * exposure;
    const light = (r * .2126 + g * .7152 + b * .0722) / 255;
    const lift = shadows * (1 - Math.min(1, light)) ** 2 + highlights * Math.min(1, light) ** 2;
    r = (r - 128) * contrast + 128 + lift + warmth + tint / 2;
    g = (g - 128) * contrast + 128 + lift - tint;
    b = (b - 128) * contrast + 128 + lift - warmth + tint / 2;
    const grey = r * .2126 + g * .7152 + b * .0722;
    const chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / Math.max(1, Math.max(r, g, b));
    const sat = saturation * (1 + vibrance * (1 - chroma));
    const pixel = i / 4, nx = (pixel % width + .5) / width * 2 - 1, ny = (Math.floor(pixel / width) + .5) / height * 2 - 1;
    const edge = 1 - Math.max(0, vignette) * Math.min(1, (nx * nx + ny * ny) / 2) * .75;
    pixels[i] = clamp((grey + (r - grey) * sat + fade * (1 - grey / 255)) * edge);
    pixels[i + 1] = clamp((grey + (g - grey) * sat + fade * (1 - grey / 255)) * edge);
    pixels[i + 2] = clamp((grey + (b - grey) * sat + fade * (1 - grey / 255)) * edge);
  }
  return pixels;
}
export function adjustedImage(image, values = {}, maxEdge = Infinity) {
  if (!hasAdjustments(values)) return image;
  const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
  const ratio = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * ratio)); canvas.height = Math.max(1, Math.round(height * ratio));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const frame = context.getImageData(0, 0, canvas.width, canvas.height);
  adjustPixels(frame.data, canvas.width, canvas.height, values); context.putImageData(frame, 0, 0);
  return canvas;
}
