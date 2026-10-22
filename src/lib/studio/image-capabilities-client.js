import { api } from "../client-api.js";

const entries = new Map();
const ttl = 60000;
let currentUser = null;

export function setImageCapabilitiesUser(userId) {
  const user = userId || null;
  if (currentUser === user) return;
  currentUser = user;
  clearImageCapabilities();
}

export function clearImageCapabilities() {
  for (const entry of entries.values()) entry.controller.abort();
  entries.clear();
}

export function readImageCapabilities(userId, provider = "") {
  if (!userId || currentUser !== userId) return Promise.reject(Object.assign(new Error("UNAUTHORIZED"), { status: 401, code: "UNAUTHORIZED" }));
  let entry = entries.get(provider);
  if (entry?.pending) return entry.promise;
  if (entry?.data && Date.now() - entry.savedAt < ttl) return Promise.resolve(entry.data);
  entry = { controller: new AbortController(), pending: true };
  entries.set(provider, entry);
  const query = new URLSearchParams({ scope: "images" });
  if (provider) query.set("imageProvider", provider);
  entry.promise = api(`/api/studio/capabilities?${query}`, { signal: entry.controller.signal }).then(data => {
    if (entry.controller.signal.aborted || currentUser !== userId) throw new DOMException("Aborted", "AbortError");
    if (!Array.isArray(data.imageModels)) throw new Error("INVALID_CAPABILITIES_RESPONSE");
    entry.data = data;
    entry.savedAt = Date.now();
    if (!provider && data.imageProvider && !entries.get(data.imageProvider)?.pending) entries.set(data.imageProvider, entry);
    return data;
  }).catch(error => {
    if (entries.get(provider) === entry) entries.delete(provider);
    if ([401, 403].includes(error.status) && currentUser === userId) clearImageCapabilities();
    throw error;
  }).finally(() => {
    entry.pending = false;
    for (const [key, candidate] of entries) {
      if (entries.size <= 12) break;
      if (!candidate.pending) entries.delete(key);
    }
  });
  return entry.promise;
}
