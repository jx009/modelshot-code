import sharp from "sharp";
import { editRegion } from "../../studio/selection-geometry.js";
import { alphaMask, maskPixels, compositeSelection, moveSelection } from "./pixels.js";
import { editFrame, restoreEditFrame } from "./edit-frame.js";

export async function prepareObjectEdit(image, mask, { remove = false, editPadding = 0.25 } = {}) {
  const { width, height } = await sharp(image).metadata();
  const pixels = await maskPixels(mask, width, height);
  let left = width, top = height, right = -1, bottom = -1;
  for (let i = 0; i < pixels.length; i++) if (pixels[i] > 16) {
    const x = i % width, y = Math.floor(i / width);
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  // maskPixels rejects all-zero input; very faint masks still need a valid box.
  if (right < left) throw new Error("EMPTY_MASK");
  const bounds = { left, top, width: right - left + 1, height: bottom - top + 1 };
  // Repair a surrounding patch, including contact/cast shadows. A hard binary
  // silhouette copies every slight lighting difference back as a cat-shaped scar.
  const region = editRegion(bounds, width, height, remove ? 0.25 : editPadding);
  const context = remove ? { left: 0, top: 0, width, height } : editRegion(region, width, height, 0.2);
  const blend = Buffer.alloc(width * height);
  const feather = Math.max(1, Math.min(remove ? 48 : 8, Math.round(Math.min(region.width, region.height) * (remove ? 0.08 : 0.025))));
  for (let y = region.top; y < region.top + region.height; y++) for (let x = region.left; x < region.left + region.width; x++) {
    const edge = Math.min(region.left ? x - region.left + 1 : feather, region.left + region.width < width ? region.left + region.width - x : feather,
      region.top ? y - region.top + 1 : feather, region.top + region.height < height ? region.top + region.height - y : feather);
    const weight = Math.min(1, edge / feather);
    blend[y * width + x] = pixels[y * width + x] > 16 ? 255 : Math.round(255 * weight * weight * (3 - 2 * weight));
  }
  const blendMask = await sharp(blend, { raw: { width, height, channels: 1 } }).png().toBuffer();
  // Supply the isolated object as a visual identity reference. This makes the
  // selection explicit even on gateways that poorly follow alpha masks.
  const object = await sharp(image).ensureAlpha().raw().toBuffer();
  for (let i = 0; i < pixels.length; i++) object[i * 4 + 3] = Math.round(object[i * 4 + 3] * pixels[i] / 255);
  const reference = await sharp(object, { raw: { width, height, channels: 4 } }).extract(bounds).png().toBuffer();
  // The provider sees the same editable area that will be composited back.
  // Keeping this separate from the source selection is what lets a pose or
  // replacement grow beyond the old silhouette while preserving the outside.
  const croppedMask = await sharp(blendMask).extract(context).png().toBuffer();
  return {
    image: await sharp(image).extract(context).png().toBuffer(), reference, bounds, region, context, blendMask,
    mask: await alphaMask(croppedMask, context.width, context.height),
    size: context.width / context.height > 1.25 ? "1536x1024" : context.height / context.width > 1.25 ? "1024x1536" : "1024x1024",
  };
}

export async function runObjectEdit(config, snapshot, image, mask, signal, generate) {
  const remove = snapshot.tool === "move";
  const prepared = await prepareObjectEdit(image, mask, { remove, editPadding: snapshot.params.editPadding });
  const { bounds, context } = prepared;
  const frame = await editFrame(prepared.image, prepared.mask, prepared.size);
  const target = [bounds.left - context.left, bounds.top - context.top, bounds.width, bounds.height]
    .map((value, index) => {
      const horizontal = index % 2 === 0;
      const scaled = value / (horizontal ? context.width : context.height) * (horizontal ? frame.content.width : frame.content.height);
      return Math.round((scaled + (index < 2 ? horizontal ? frame.content.left : frame.content.top : 0)) / (horizontal ? frame.width : frame.height) * 1000);
    });
  const prompt = [
    "Edit the FIRST image in place, keeping its exact composition, camera and dimensions. The SECOND image is an isolated reference identifying the ONE selected object, not another object to add.",
    `The selected object's bounding box in the first image is x=${target[0]}, y=${target[1]}, width=${target[2]}, height=${target[3]} on a 0–1000 coordinate scale.`,
    remove
      ? "Remove ONLY this object at its old location, including its cast shadow. Fill the hole with a seamless continuation of the surrounding background. Do not redraw or move other objects."
      : "Apply the requested change ONLY to this object. A new shape or pose may extend beyond its previous silhouette within the editable mask. Reconstruct the background where the old shape was. Preserve unrelated people, objects, lighting and background; do not change their identity. Match the original style and natural contact shadows.",
    "Return just the edited first image, without borders, side-by-side panels, selection outlines or reference thumbnails.",
    snapshot.params.prompt || "",
  ].join("\n");
  const generated = await generate(config, { image: frame.image, references: [prepared.reference], mask: frame.mask, prompt: prompt + "\nKeep the output canvas and any outer gray padding exactly the same. Preserve the perspective and exposure of the surrounding scene.", size: prepared.size, signal });
  const crop = await restoreEditFrame(generated, frame);
  const placed = await sharp(image).composite([{ input: crop, left: context.left, top: context.top }]).png().toBuffer();
  const edited = await compositeSelection(image, placed, prepared.blendMask);
  // The primary result is always a complete image. The request retains the
  // source, mask and extracted object for further edits and undo.
  return { images: [remove ? await moveSelection(image, edited, mask, snapshot.params.dx, snapshot.params.dy) : edited], placement: "replace-source" };
}
