import sharp from "sharp";
import { AppError } from "../../http.js";
import { maskPixels } from "./pixels.js";

// Selection geometry is only a prompt to the semantic model. It must never
// become the final alpha by intersecting the returned object with a lasso.
export async function selectionPrompt(selection, width, height, point) {
  if (point) {
    if (!Number.isInteger(point.x) || !Number.isInteger(point.y) || point.x < 0 || point.y < 0 || point.x >= width || point.y >= height) throw new AppError("INVALID_SELECTION");
    return { points: [{ ...point, label: 1 }] };
  }
  const pixels = await maskPixels(selection, width, height);
  const box = maskBounds(pixels, width, height);
  const centerX = box.left + Math.floor(box.width / 2), centerY = box.top + Math.floor(box.height / 2);
  let nearest = -1, distance = Infinity;
  for (let i = 0; i < pixels.length; i++) {
    if (pixels[i] <= 127) continue;
    const x = i % width, y = Math.floor(i / width);
    const next = (x - centerX) ** 2 + (y - centerY) ** 2;
    if (next < distance) { nearest = i; distance = next; }
  }
  if (nearest < 0) throw new AppError("INVALID_SELECTION", 422);
  return { box, points: [{ x: nearest % width, y: Math.floor(nearest / width), label: 1 }] };
}

export function maskBounds(pixels, width, height) {
  let left = width, top = height, right = -1, bottom = -1;
  for (let i = 0; i < pixels.length; i++) if (pixels[i] > 16) {
    const x = i % width, y = Math.floor(i / width);
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  if (right < left) throw new AppError("SEGMENTATION_FAILED", 422);
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

export function segmentMaskScore(pixels, selection, width, height, prompt) {
  const point = prompt.points?.find(item => item.label === 1);
  if (point && pixels[point.y * width + point.x] <= 64) return -Infinity;
  const box = prompt.box;
  let area = 0, overlap = 0, selected = 0;
  for (let i = 0; i < pixels.length; i++) {
    const x = i % width, y = Math.floor(i / width);
    const inSelection = box && (selection ? selection[i] > 127 : x >= box.left && x < box.left + box.width && y >= box.top && y < box.top + box.height);
    if (inSelection) selected++;
    if (pixels[i] <= 64) continue;
    area++;
    if (inSelection) overlap++;
  }
  if (!area || area > width * height * 0.85) return -Infinity;
  if (!box) return area;
  if (!selected || overlap < Math.max(3, selected * 0.08) || overlap / area < 0.35) return -Infinity;
  return overlap * (overlap / area);
}

export async function extractObject(image, mask) {
  const { width, height } = await sharp(image).metadata();
  const alpha = await maskPixels(mask, width, height);
  const bounds = maskBounds(alpha, width, height);
  const foreground = await sharp(image).ensureAlpha().raw().toBuffer(), background = Buffer.from(foreground);
  for (let i = 0; i < alpha.length; i++) {
    foreground[i * 4 + 3] = Math.round(foreground[i * 4 + 3] * alpha[i] / 255);
    background[i * 4 + 3] = Math.round(background[i * 4 + 3] * (255 - alpha[i]) / 255);
  }
  const raw = { width, height, channels: 4 };
  return { bounds, cutout: await sharp(foreground, { raw }).png().toBuffer(),
    object: await sharp(foreground, { raw }).extract(bounds).png().toBuffer(),
    hole: await sharp(background, { raw }).png().toBuffer() };
}
