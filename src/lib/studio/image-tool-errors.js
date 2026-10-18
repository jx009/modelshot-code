const messages = {
  INVALID_IMAGE_SIZE: ["图片文件过大，或转为无损 PNG 后超过保存上限。", "The image exceeds the file limit, possibly after lossless PNG conversion."],
  UPSCALE_SCALE_UNSUPPORTED: ["当前超分服务支持 2 倍放大。", "This upscale service supports 2×."],
  UPSCALE_INPUT_DIMENSIONS: ["超分输入需宽 50–2128、高 50–4064 像素，请先裁剪或调整尺寸。", "Upscaling requires width 50–2128 and height 50–4064 pixels. Crop or resize first."],
  UPSCALE_INPUT_TOO_LARGE: ["超分输入图片需不超过 5 MB。", "Upscale input must be at most 5 MB."],
  UPSCALE_SIZE_MISMATCH: ["超分服务返回的尺寸不符合 2 倍放大要求，原图已保留。", "The upscale result is not exactly 2×. Your original was preserved."],
  INVALID_UPSCALE_RESULT: ["超分服务返回的图片无效或文件过大，原图已保留。", "The upscale result is invalid or too large. Your original was preserved."],
};

export function imageToolErrorMessage(code, zh = true) {
  return messages[code]?.[zh ? 0 : 1] || code;
}
