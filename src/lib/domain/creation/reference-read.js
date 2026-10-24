import { createHash } from "node:crypto";
import { AppError } from "../../http.js";
import { REFERENCE_OFFICE_BYTES } from "../../creation/reference-policy.js";

export async function readReferenceBytes(file, store, signal) {
  if (!Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > REFERENCE_OFFICE_BYTES || !/^[a-f0-9]{64}$/.test(file.checksum)) throw new AppError("CREATION_REFERENCE_INVALID", 422);
  signal.throwIfAborted();
  const reader = (await store.stream(file.objectKey, undefined, signal)).getReader();
  const bytes = Buffer.allocUnsafe(file.bytes), hash = createHash("sha256"); let offset = 0;
  const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read(); signal.throwIfAborted();
      if (done) break;
      if (offset + value.byteLength > bytes.length) throw new AppError("CREATION_REFERENCE_INTEGRITY_FAILED", 422);
      bytes.set(value, offset); hash.update(value); offset += value.byteLength;
    }
    if (offset !== bytes.length || hash.digest("hex") !== file.checksum) throw new AppError("CREATION_REFERENCE_INTEGRITY_FAILED", 422);
    return bytes;
  } finally { signal.removeEventListener("abort", cancel); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
