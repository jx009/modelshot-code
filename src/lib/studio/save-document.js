import { api } from "../client-api.js";

export function transientSaveError(error) {
  if (error.code === "DOCUMENT_SAVE_UNAVAILABLE") return true;
  if (error.retryable === false) return false;
  return error instanceof TypeError || ["TimeoutError", "AbortError"].includes(error.name) ||
    [408, 429, 500, 502, 503, 504].includes(error.status) || error.code === "INVALID_SAVE_RESPONSE";
}

// Only document snapshots are retried. Generation/payment requests must never use this helper.
export async function submitDocument(body, { isCurrent = () => true, onRetry = () => {}, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!isCurrent()) throw new Error("SESSION_CLOSED");
    try {
      const saved = await api("/api/studio/documents", { method: "POST", body, signal: AbortSignal.timeout(20000) });
      if (!saved?.id || !Number.isInteger(saved.version) || !Array.isArray(saved.content?.messages)) {
        throw Object.assign(new Error("INVALID_SAVE_RESPONSE"), { code: "INVALID_SAVE_RESPONSE" });
      }
      return saved;
    } catch (error) {
      if (!isCurrent()) throw new Error("SESSION_CLOSED");
      if (error.status === 413) error.code = "DOCUMENT_SAVE_TOO_LARGE";
      if (!transientSaveError(error)) throw error;
      if (attempt === 2) {
        throw Object.assign(new Error("DOCUMENT_SAVE_UNAVAILABLE", { cause: error }), {
          code: "DOCUMENT_SAVE_UNAVAILABLE", status: error.status, traceId: error.traceId,
        });
      }
      onRetry();
      await wait(attempt === 0 ? 750 : 2000);
    }
  }
}
