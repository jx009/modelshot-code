import { layoutDocumentSchema } from "../contracts/layout.js";

export const POSTER_MAX_PIXELS = 8_000_000;
export const POSTER_IMAGE_PIXELS = 16_000_000;
export function validatePosterExport(input, format) {
  if (!["png", "jpeg"].includes(format)) throw new Error("EXPORT_FORMAT_UNSUPPORTED");
  const document = layoutDocumentSchema.parse(input);
  if (document.kind !== "poster") throw new Error("EXPORT_KIND_UNSUPPORTED");
  const page = document.pages[0], width = Math.ceil(page.width), height = Math.ceil(page.height);
  // Reject rather than silently shrink the user's design. Pixel ratio is always
  // 1, independent of the export host's display/device settings.
  if (width * height > POSTER_MAX_PIXELS) throw new Error("EXPORT_POSTER_SIZE_UNSUPPORTED");
  return { document, page, width, height };
}
export function checkPosterImagePixels(images) {
  let pixels = 0;
  for (const image of images.values()) {
    if (!Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width <= 0 || image.height <= 0) throw new Error("EXPORT_IMAGE_UNSUPPORTED");
    pixels += image.width * image.height;
    if (pixels > POSTER_IMAGE_PIXELS) throw new Error("EXPORT_IMAGE_PIXELS_EXCEEDED");
  }
}
