// Volcengine CVProcess lens_vida_nnsr limits, per the official V2 API.
// A valid compressed provider result can expand to ~160 MB as a 40 MP RGBA PNG.
// This limit applies only to server-normalized upscale outputs, not uploads.
export const UPSCALE_MAX_NORMALIZED_BYTES = 160 * 1024 * 1024;

export function upscaleInputError({ width, height, bytes }, scale) {
  if (scale !== 2) return "UPSCALE_SCALE_UNSUPPORTED";
  if (width < 50 || height < 50 || width > 2128 || height > 4064) return "UPSCALE_INPUT_DIMENSIONS";
  if (bytes > 5 * 1024 * 1024) return "UPSCALE_INPUT_TOO_LARGE";
  return null;
}
