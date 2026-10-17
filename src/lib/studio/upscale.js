// Volcengine CVProcess lens_vida_nnsr limits, per the official V2 API.
export function upscaleInputError({ width, height, bytes }, scale) {
  if (scale !== 2) return "UPSCALE_SCALE_UNSUPPORTED";
  if (width < 50 || height < 50 || width > 2128 || height > 4064) return "UPSCALE_INPUT_DIMENSIONS";
  if (bytes > 5 * 1024 * 1024) return "UPSCALE_INPUT_TOO_LARGE";
  return null;
}
