import { Agent } from "undici";

// Synchronous image gateways can take several minutes before sending headers.
// Keep transport limits aligned with the worker budget; never retry paid POSTs.
export const IMAGE_REQUEST_TIMEOUT_MS = 600_000;
const dispatcher = new Agent({ headersTimeout: IMAGE_REQUEST_TIMEOUT_MS, bodyTimeout: IMAGE_REQUEST_TIMEOUT_MS });

export function imageFetch(url, options) {
  return fetch(url, { ...options, dispatcher });
}
