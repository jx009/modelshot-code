import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

// HTTP/IP installations do not expose SubtleCrypto. Keep the same SHA-256
// identity on both paths so retries cannot create a second paid submission.
export async function maskHash(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (globalThis.crypto?.subtle) {
    return bytesToHex(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes)));
  }
  return bytesToHex(sha256(bytes));
}
