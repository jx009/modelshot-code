"use client";
import { api } from "./client-api.js";

export async function uploadImage(file) {
  if (!file || !["image/png", "image/jpeg", "image/webp"].includes(file.type) || !file.size || file.size > 10 * 1024 * 1024) throw new Error("请选择 10 MB 以内的 PNG / JPG / WebP 图片。");
  if (!globalThis.crypto?.subtle) throw new Error("请通过 HTTPS 访问网站后上传图片。");
  const checksum = [...new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()))].map(v => v.toString(16).padStart(2, "0")).join("");
  const plan = await api("/api/upload/direct", { method: "POST", timeoutMs: 30000, body: { contentType: file.type, bytes: file.size, checksum } });
  if (plan.mode === "proxy") {
    const body = new FormData(); body.append("file", file);
    const response = await fetch("/api/upload", { method: "POST", body, signal: AbortSignal.timeout(90000) });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.code || "UPLOAD_FAILED"), { code: result.code });
    return result;
  }
  if (plan.mode !== "cos" || !plan.url || !plan.uploadId) throw new Error("上传服务响应异常，请刷新后重试。");
  try {
    const response = await fetch(plan.url, { method: "PUT", headers: plan.headers, body: file, credentials: "omit", signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error("COS_UPLOAD_FAILED");
  } catch { throw new Error("图片直传 COS 失败，请检查网络及 COS 跨域配置是否允许 PUT 上传。"); }
  // Retry registration only. Never retransmit the image or create another asset.
  try { return await api("/api/upload/direct", { method: "PATCH", timeoutMs: 90000, body: { uploadId: plan.uploadId } }); }
  catch (error) {
    if (error.status && error.status < 500) throw error;
    return api("/api/upload/direct", { method: "PATCH", timeoutMs: 90000, body: { uploadId: plan.uploadId } });
  }
}
