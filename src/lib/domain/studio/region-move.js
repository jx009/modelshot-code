import sharp from "sharp";
import { AppError } from "../../http.js";
import { regionInside, regionCorners, regionBounds } from "../../studio/move-geometry.js";
import { editRegion } from "../../studio/selection-geometry.js";
import { alphaMask, compositeSelection } from "./pixels.js";
import { editFrame, restoreEditFrame } from "./edit-frame.js";

export async function runRegionMove(config, snapshot, image, signal, generate) {
  const { width, height } = await sharp(image).metadata();
  const { moveSource: source, moveTarget: target } = snapshot.params;
  if (![source, target].every(r => regionInside(r, width, height))) throw new AppError("MOVE_OUT_OF_BOUNDS", 422);
  const regions = [source, target].map(r => editRegion(regionBounds(r), width, height, 0.2));
  const blend = Buffer.alloc(width * height);
  // Give the model room to repair the old footprint and synthesize natural
  // contact shadows at the destination. Pixels outside these regions stay exact.
  for (const r of regions) {
    const feather = Math.max(2, Math.min(32, Math.round(Math.min(r.width, r.height) * 0.08)));
    for (let y = r.top; y < r.top + r.height; y++) for (let x = r.left; x < r.left + r.width; x++) {
      const distance = Math.min(r.left ? x - r.left + 1 : feather, r.top ? y - r.top + 1 : feather,
        r.left + r.width < width ? r.left + r.width - x : feather, r.top + r.height < height ? r.top + r.height - y : feather);
      const value = Math.min(1, distance / feather);
      const i = y * width + x;
      blend[i] = Math.max(blend[i], Math.round(255 * value * value * (3 - 2 * value)));
    }
  }
  const mask = await sharp(blend, { raw: { width, height, channels: 1 } }).png().toBuffer();
  const size = width / height > 1.25 ? "1536x1024" : height / width > 1.25 ? "1024x1536" : "1024x1024";
  const frame = await editFrame(image, await alphaMask(mask, width, height), size);
  const points = r => regionCorners(r).map(p => `${p.x},${p.y}`).join(" ");
  const stroke = Math.max(2, width / 250);
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><polygon points="${points(source)}" fill="none" stroke="#ff4040" stroke-width="${stroke}"/><polygon points="${points(target)}" fill="none" stroke="#4080ff" stroke-width="${stroke}"/></svg>`);
  const guide = await sharp(image).composite([{ input: svg }]).png().toBuffer();
  const guideFrame = await editFrame(guide, await alphaMask(mask, width, height), size);
  const prompt = [
    "Edit the FIRST image. The SECOND image is only a placement guide: RED outlines the source selection, BLUE outlines its destination. Never include colored outlines or guide graphics in the result.",
    `Image dimensions before outer padding: ${width}x${height}. Source region: ${JSON.stringify(source)}. Destination region: ${JSON.stringify(target)}. Coordinates are pixels; rotation is clockwise about each region's top-left origin.`,
    "Identify the complete main object selected in RED. Move that same object into BLUE, applying the indicated relative scale and rotation. Do not move the rectangular background patch. Preserve the object's identity, texture and details.",
    "Remove the object and its old shadow from the original location and reconstruct the background seamlessly. Blend its edges and recreate natural lighting and contact/cast shadows at the destination. Leave all unrelated objects and the surrounding scene unchanged. Return one complete edited scene, never a cutout or a collage.",
    "Keep the original canvas, aspect ratio and any outer gray padding unchanged.",
    snapshot.params.prompt || "",
  ].join("\n");
  const generated = await generate(config, { image: frame.image, references: [guideFrame.image], mask: frame.mask, prompt, size, signal });
  const result = await restoreEditFrame(generated, frame);
  return { images: [await compositeSelection(image, result, mask)], placement: "append" };
}
