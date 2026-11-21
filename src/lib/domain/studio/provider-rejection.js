import { AppError } from "../../http.js";

// 供应商拒绝时保留状态码、请求路径和响应开头，便于排查；去掉疑似密钥，长度受限。
export async function providerRejection(response, path) {
  let body = "";
  try { body = (await response.text()).replace(/\s+/g, " ").replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 300); } catch { /* 响应体不可读 */ }
  // 输入图被判为真人：这是内容审核结论，不是参数写错，重试同一张图也不会通过。
  const code = /InputImageSensitiveContentDetected|may contain real person/.test(body) ? "VIDEO_IMAGE_REAL_PERSON" : "VIDEO_PROVIDER_REJECTED";
  return Object.assign(new AppError(code, response.status >= 400 ? response.status : 502),
    { providerStatus: response.status, providerPath: path, providerBody: body });
}
