import sharp from "sharp";
import { CROP_PATHS, cropCells } from "../../studio/crop-geometry.js";
import { AppError } from "../../http.js";

export async function maskPixels(mask, width, height) {
  const meta = await sharp(mask).metadata();
  if (meta.width !== width || meta.height !== height) throw new AppError("MASK_SIZE_MISMATCH");
  const data = await sharp(mask).flatten({ background: "black" }).greyscale().raw().toBuffer();
  if (!data.some(value => value > 0)) throw new AppError("EMPTY_MASK");
  return data;
}
export async function alphaMask(mask, width, height) {
  const selection = await maskPixels(mask, width, height);
  const data = Buffer.alloc(width * height * 4, 255);
  for (let i = 0; i < selection.length; i++) data[i * 4 + 3] = 255 - selection[i];
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}
export async function compositeSelection(original, generated, mask) {
  const { width, height } = await sharp(original).metadata();
  const selection = await maskPixels(mask, width, height);
  const a = await sharp(original).ensureAlpha().raw().toBuffer();
  const b = await sharp(generated).resize(width, height, { fit: "fill" }).ensureAlpha().raw().toBuffer();
  for (let i = 0; i < selection.length; i++) for (let channel = 0; channel < 4; channel++) {
    const offset = i * 4 + channel;
    a[offset] = Math.round(a[offset] * (1 - selection[i] / 255) + b[offset] * selection[i] / 255);
  }
  return sharp(a, { raw: { width, height, channels: 4 } }).png().toBuffer();
}
export async function cropImage(image, rect) {
  const { width, height } = await sharp(image).metadata();
  if (!rect || rect.left + rect.width > width || rect.top + rect.height > height) throw new AppError("CROP_OUT_OF_BOUNDS");
  return sharp(image).extract(rect).png().toBuffer();
}
export async function cropOutputs(image, params) {
  const { rect, cropShape = "rectangle", cropGrid } = params;
  const base = await cropImage(image, rect);
  if (cropShape === "grid") {
    const cells = cropCells({ ...rect, left: 0, top: 0 }, cropGrid || { x: [.5], y: [.5] });
    if (cells.some(cell => cell.width < 1 || cell.height < 1)) throw new AppError("CROP_GRID_TOO_SMALL", 422);
    return Promise.all(cells.map(cell => sharp(base).extract(cell).png().toBuffer()));
  }
  const path = CROP_PATHS[cropShape];
  if (!path) return [base];
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${rect.width}" height="${rect.height}" viewBox="0 0 100 100" preserveAspectRatio="none"><path d="${path}" fill="white"/></svg>`);
  return [await sharp(base).ensureAlpha().composite([{ input: svg, blend: "dest-in" }]).png().toBuffer()];
}
export async function expandInput(image, padding) {
  const { width, height } = await sharp(image).metadata();
  const edges = typeof padding === "number" ? { left: padding, right: padding, top: padding, bottom: padding } : padding;
  const w = width + edges.left + edges.right, h = height + edges.top + edges.bottom;
  if (w > 8192 || h > 8192 || w * h > 40000000) throw new AppError("IMAGE_TOO_LARGE", 413);
  const expanded = await sharp(image).extend({ ...edges, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const mask = await sharp({ create: { width: w, height: h, channels: 3, background: "white" } }).composite([{ input: await sharp({ create: { width, height, channels: 3, background: "black" } }).png().toBuffer(), left: edges.left, top: edges.top }]).png().toBuffer();
  return { image: expanded, mask };
}
export async function moveSelection(original, repaired, mask, dx, dy) {
  const { width, height } = await sharp(original).metadata();
  if (Math.abs(dx) >= width || Math.abs(dy) >= height) throw new AppError("MOVE_OUT_OF_BOUNDS");
  const alpha = await maskPixels(mask, width, height);
  const raw = await sharp(original).ensureAlpha().raw().toBuffer();
  for (let i = 0; i < alpha.length; i++) raw[i * 4 + 3] = Math.round(raw[i * 4 + 3] * alpha[i] / 255);
  const foreground = await sharp(raw, { raw: { width, height, channels: 4 } }).extract({ left: Math.max(0, -dx), top: Math.max(0, -dy), width: width - Math.abs(dx), height: height - Math.abs(dy) }).png().toBuffer();
  return sharp(repaired).composite([{ input: foreground, left: Math.max(0, dx), top: Math.max(0, dy) }]).png().toBuffer();
}
