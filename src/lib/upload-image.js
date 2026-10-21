"use client";
import { api } from "./client-api.js";
import { uploadCosObject } from "./cos-upload.js";
import { IMAGE_UPLOAD_MAX_BYTES } from "./image-upload-limits.js";

const MAX_CONCURRENT_UPLOADS = 2;
let activeUploads = 0;
const uploadQueue = [];
let hashWorker;
let hashRequestId = 0;
const hashPending = new Map();
const hashCache = new WeakMap();

function hashInMain(file) {
  if (!globalThis.crypto?.subtle) throw new Error("请通过 HTTPS 访问网站后上传图片。");
  return file.arrayBuffer().then(bytes => crypto.subtle.digest("SHA-256", bytes)).then(digest => [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join(""));
}

function hashFile(file) {
  const cached = hashCache.get(file);
  if (cached) return cached;
  const promise = new Promise((resolve, reject) => {
    try {
      if (!hashWorker) {
        hashWorker = new Worker(new URL("../workers/file-hash.worker.js", import.meta.url), { type: "module" });
        hashWorker.onmessage = event => {
          const request = hashPending.get(event.data?.id);
          if (!request) return;
          hashPending.delete(event.data.id);
          event.data.error ? request.reject(new Error(event.data.error)) : request.resolve(event.data.checksum);
        };
        hashWorker.onerror = error => {
          for (const request of hashPending.values()) request.reject(error);
          hashPending.clear();
          hashWorker?.terminate(); hashWorker = null;
        };
      }
      const id = ++hashRequestId;
      hashPending.set(id, { resolve, reject });
      hashWorker.postMessage({ id, file });
    } catch (error) {
      hashWorker?.terminate(); hashWorker = null;
      reject(error);
    }
  });
  hashCache.set(file, promise);
  return promise;
}

async function withUploadSlot(task) {
  if (activeUploads >= MAX_CONCURRENT_UPLOADS) await new Promise(resolve => uploadQueue.push(resolve));
  else activeUploads++;
  try { return await task(); }
  finally {
    const next = uploadQueue.shift();
    if (next) next();
    else activeUploads--;
  }
}

export async function uploadImage(file) {
  if (!file || !["image/png", "image/jpeg", "image/webp"].includes(file.type) || !file.size || file.size > IMAGE_UPLOAD_MAX_BYTES) throw new Error("请选择 50 MB 以内的 PNG / JPG / WebP 图片。");
  return withUploadSlot(async () => {
    const metadata = { contentType: file.type, bytes: file.size };
    // Hash away from the UI thread while the server chooses the upload route.
    // The proxy path remains usable without waiting for a digest.
    const checksumPromise = typeof Worker === "function"
      ? hashFile(file).then(checksum => ({ checksum }), error => ({ error }))
      : null;
    let plan = await api("/api/upload/direct", { method: "POST", timeoutMs: 30000, body: metadata });
    if (plan.mode === "checksum-required") {
      const result = checksumPromise ? await checksumPromise : null;
      const checksum = result?.error ? await hashInMain(file) : result?.checksum || await hashInMain(file);
      plan = await api("/api/upload/direct", { method: "POST", timeoutMs: 30000, body: { ...metadata, checksum } });
    }
    if (plan.mode === "existing") return plan;
    if (plan.mode === "proxy") {
      const body = new FormData(); body.append("file", file);
      const response = await fetch("/api/upload", { method: "POST", body, signal: AbortSignal.timeout(90000) });
      const result = await response.json();
      if (!response.ok) throw Object.assign(new Error(result.code || "UPLOAD_FAILED"), { code: result.code });
      return result;
    }
    if (plan.mode !== "cos" || !plan.url || !plan.uploadId) throw new Error("上传服务响应异常，请刷新后重试。");
    await uploadCosObject(plan.url, { headers: plan.headers, body: file });
    // Retry registration only. Never retransmit the image or create another asset.
    try { return await api("/api/upload/direct", { method: "PATCH", timeoutMs: 90000, body: { uploadId: plan.uploadId } }); }
    catch (error) {
      if (error.status && error.status < 500) throw error;
      return api("/api/upload/direct", { method: "PATCH", timeoutMs: 90000, body: { uploadId: plan.uploadId } });
    }
  });
}
