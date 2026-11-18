import { AppError } from "../../http.js";

// 供应商拒绝时保留状态码、请求路径和响应开头，便于排查；去掉疑似密钥，长度受限。
export async function providerRejection(response, path) {
  let body = "";
  try { body = (await response.text()).replace(/\s+/g, " ").replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 300); } catch { /* 响应体不可读 */ }
  return Object.assign(new AppError("VIDEO_PROVIDER_REJECTED", response.status >= 400 ? response.status : 502),
    { providerStatus: response.status, providerPath: path, providerBody: body });
}
