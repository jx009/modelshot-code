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
