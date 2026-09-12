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

export async function api(url, { method = "GET", body, key, signal } = {}) {
  const response = await fetch(url, { method, signal, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(key ? { "Idempotency-Key": key } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.code || data.error || "REQUEST_FAILED");
    error.code = data.code || data.error || "REQUEST_FAILED";
    error.status = response.status;
    throw error;
  }
  return data;
}

export const terminalStatus = status => ["succeeded", "failed", "cancelled", "partial_success"].includes(status);
export function safeNext(value, fallback = "/studio") {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !/[\\\x00-\x20]/.test(value) ? value : fallback;
}
