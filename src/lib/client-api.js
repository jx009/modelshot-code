import { assetDeliveryEpoch, consumeAssetDelivery } from "./studio/asset-delivery.js";

/**
 * 幂等键生成器。
 *
 * crypto.randomUUID() 只在「安全上下文」可用（HTTPS，或 localhost / 127.0.0.1）。
 * 用纯 HTTP + IP 或域名访问时它是 undefined，调用会直接抛 TypeError，
 * 表现是按钮点了完全没反应、界面也不报错，非常难排查。
 * crypto.getRandomValues() 不受这个限制，因此在非安全上下文降级为 16 字节随机 hex。
 * 32 位 hex 满足服务端 /^[a-zA-Z0-9_-]{16,128}$/ 的格式要求。
 */
export function requestKey() {
  const crypto = globalThis.crypto;
  if (crypto?.randomUUID) return crypto.randomUUID();
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function api(url, { method = "GET", body, key, signal, timeoutMs = method.toUpperCase() === "GET" ? 15000 : 0 } = {}) {
  const deliveryEpoch = assetDeliveryEpoch();
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason);
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });
  let timedOut = false;
  const timer = timeoutMs > 0 ? setTimeout(() => {
    if (controller.signal.aborted) return;
    timedOut = true;
    controller.abort();
  }, timeoutMs) : null;
  try {
    const multipart = typeof FormData !== "undefined" && body instanceof FormData;
    const response = await fetch(url, { method, signal: controller.signal, headers: { ...(body && !multipart ? { "Content-Type": "application/json" } : {}), ...(key ? { "Idempotency-Key": key } : {}) }, ...(body ? { body: multipart ? body : JSON.stringify(body) } : {}) });
    const data = await response.json().catch(error => {
      if (controller.signal.aborted || error.name !== "SyntaxError") throw error;
      return {};
    });
    if (controller.signal.aborted) throw controller.signal.reason;
    if (!response.ok) {
      const code = data.code || data.error || "REQUEST_FAILED";
      const error = new Error(code);
      error.code = code;
      error.status = response.status;
      error.url = url;
      error.method = method;
      error.detail = data.message || data.detail || "";
      error.traceId = data.traceId || "";
      error.retryable = data.retryable;
      throw error;
    }
    return consumeAssetDelivery(data, deliveryEpoch);
  } catch (error) {
    if (!timedOut) throw error;
    const timeout = new Error("REQUEST_TIMEOUT");
    Object.assign(timeout, { code: "REQUEST_TIMEOUT", url, method, retryable: method.toUpperCase() === "GET" });
    throw timeout;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}

export const terminalStatus = status => ["succeeded", "failed", "cancelled", "partial_success"].includes(status);
export function safeNext(value, fallback = "/studio-v2") {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !/[\\\x00-\x20]/.test(value) ? value : fallback;
}
