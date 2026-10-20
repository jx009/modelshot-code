const messages = {
  EDIT_GEOMETRY_MISMATCH: ["模型返回的比例不符合编辑画布，已保留原图，请重试或更换模型。", "The result does not match the editing canvas. Your original was preserved; retry or change the model."],
  EDIT_INCOMPLETE: ["模型未补全扩图区域，已保留原图，请重试或更换模型。", "The model did not fill the expanded area. Your original was preserved; retry or change the model."],
  TOO_MANY_EDIT_REFERENCES: ["当前模型的局部修改最多可添加 1 张参考图，请移除多余参考图。", "Local edits with this model allow one reference image. Remove extra references."],
  INVALID_IMAGE_SIZE: ["图片文件过大，或转为无损 PNG 后超过保存上限。", "The image exceeds the file limit, possibly after lossless PNG conversion."],
  UPSCALE_SCALE_UNSUPPORTED: ["当前超分服务支持 2 倍放大。", "This upscale service supports 2×."],
  UPSCALE_INPUT_DIMENSIONS: ["超分输入需宽 50–2128、高 50–4064 像素，请先裁剪或调整尺寸。", "Upscaling requires width 50–2128 and height 50–4064 pixels. Crop or resize first."],
  UPSCALE_INPUT_TOO_LARGE: ["超分输入图片需不超过 5 MB。", "Upscale input must be at most 5 MB."],
  UPSCALE_SIZE_MISMATCH: ["超分服务返回的尺寸不符合 2 倍放大要求，原图已保留。", "The upscale result is not exactly 2×. Your original was preserved."],
  INVALID_UPSCALE_RESULT: ["超分服务返回的图片无效或文件过大，原图已保留。", "The upscale result is invalid or too large. Your original was preserved."],
};

export function imageToolErrorMessage(code, zh = true) {
  if (/^(PROVIDER_TIMEOUT|PROVIDER_RESULT_UNAVAILABLE|PROVIDER_RESULT_UNKNOWN)(:|$)/.test(code || "")) {
    const timeout = /PROVIDER_TIMEOUT|HTTP (408|504|524)|TIMEOUT/i.test(code);
    return zh ? timeout ? "上游连接超时，未收到结果，本次不扣积分。请重试。" : "连接中断，未收到结果，本次不扣积分。请重试。"
      : timeout ? "The upstream timed out without a result. No credits were charged. Please retry." : "The connection ended without a result. No credits were charged. Please retry.";
  }
  return messages[code]?.[zh ? 0 : 1] || code;
}
