/* global crypto */

globalThis.onmessage = async event => {
  const { id, file } = event.data || {};
  try {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    const checksum = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
    globalThis.postMessage({ id, checksum });
  } catch (error) {
    globalThis.postMessage({ id, error: error?.message || "HASH_FAILED" });
  }
};
