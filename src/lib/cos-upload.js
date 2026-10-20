"use client";

export async function uploadCosObject(url, { headers, body, timeoutMs = 120000 }) {
  let response;
  try {
    response = await fetch(url, { method: "PUT", headers, body, credentials: "omit", signal: AbortSignal.timeout(timeoutMs) });
  } catch (cause) {
    const timedOut = cause?.name === "TimeoutError" || cause?.name === "AbortError";
    throw new Error(timedOut
      ? "图片直传 COS 超时，请检查网络后重试。"
      : "图片直传 COS 失败：浏览器未能读取响应，请检查网络及存储桶 CORS 是否允许当前网站来源、PUT 方法和 Content-Type 请求头。", { cause });
  }
  if (!response.ok) {
    throw Object.assign(new Error(`图片直传 COS 被拒绝（HTTP ${response.status}），请检查上传签名、访问权限及存储桶配置。`),
      { status: response.status });
  }
}
