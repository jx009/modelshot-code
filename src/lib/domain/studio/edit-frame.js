import sharp from "sharp";
import { AppError } from "../../http.js";

// Give the provider a canvas with the requested aspect ratio. Never stretch a
// differently shaped provider response into the selected object's silhouette.
export async function editFrame(image, mask, size) {
  const [width, height] = size.split("x").map(Number);
  const source = await sharp(image).metadata();
  const scale = Math.min(width / source.width, height / source.height);
  const content = { width: Math.max(1, Math.round(source.width * scale)), height: Math.max(1, Math.round(source.height * scale)) };
  content.left = Math.floor((width - content.width) / 2);
  content.top = Math.floor((height - content.height) / 2);
  const resized = await sharp(image).resize(content.width, content.height).png().toBuffer();
  const resizedMask = await sharp(mask).resize(content.width, content.height).png().toBuffer();
  return {
    width, height, content, sourceWidth: source.width, sourceHeight: source.height,
    image: await sharp({ create: { width, height, channels: 4, background: "#808080" } }).composite([{ input: resized, left: content.left, top: content.top }]).png().toBuffer(),
    mask: await sharp(resizedMask).extend({ left: content.left, top: content.top, right: width - content.width - content.left, bottom: height - content.height - content.top, background: "white" }).png().toBuffer(),
  };
}

export async function restoreEditFrame(generated, frame) {
  const meta = await sharp(generated).metadata();
  if (!meta.width || !meta.height || Math.abs((meta.width / meta.height) / (frame.width / frame.height) - 1) > 0.025) {
    throw new AppError("EDIT_GEOMETRY_MISMATCH", 422);
  }
  const normalized = await sharp(generated).resize(frame.width, frame.height).png().toBuffer();
  return sharp(normalized).extract(frame.content).resize(frame.sourceWidth, frame.sourceHeight).png().toBuffer();
}
