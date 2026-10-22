import { api } from "../client-api.js";

const entries = new Map();
const TTL = 30_000;

function listKey(userId, query) {
  const params = new URLSearchParams(query);
  params.set("paged", "1");
  if (!params.get("q")) params.delete("q");
  if (params.get("kind") === "all") params.delete("kind");
  params.sort();
  return { key: JSON.stringify([userId, params.toString()]), query: params.toString() };
}

export function invalidateProjectLists(userId) {
  for (const [key, entry] of entries) if (entry.userId === userId) entries.delete(key);
}

export function peekProjectList(userId, query = "paged=1") {
  const { key } = listKey(userId, query);
  const entry = entries.get(key);
  if (!entry?.data || Date.now() - entry.savedAt >= TTL) return null;
  return entry.data;
}

export function readProjectList(userId, query = "paged=1", { signal } = {}) {
  if (!userId) return Promise.reject(new Error("UNAUTHORIZED"));
  if (signal?.aborted) return Promise.reject(signal.reason);
  const cached = peekProjectList(userId, query);
  if (cached) return Promise.resolve(cached);
  const normalized = listKey(userId, query), key = normalized.key;
  let entry = entries.get(key);
  if (!entry?.pending) {
    const controller = new AbortController();
    entry = { userId, controller, readers: 0, pending: true };
    entries.set(key, entry);
    entry.promise = api(`/api/studio/documents?${normalized.query}`, { signal: controller.signal }).then(data => {
      if (entries.get(key) === entry && !controller.signal.aborted) {
        entry.data = data;
        entry.savedAt = Date.now();
      }
      return data;
    }).catch(error => {
      if (entries.get(key) === entry) entries.delete(key);
      if ([401, 403].includes(error.status)) invalidateProjectLists(userId);
      throw error;
    }).finally(() => {
      entry.pending = false;
      for (const [oldKey, oldEntry] of entries) {
        if (entries.size <= 40) break;
        if (!oldEntry.pending) entries.delete(oldKey);
      }
    });
  }
  entry.readers++;
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (callback, value) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener("abort", cancel);
      entry.readers--;
      if (!entry.readers && entry.pending) {
        if (entries.get(key) === entry) entries.delete(key);
        entry.controller.abort();
      }
      callback(value);
    };
    const cancel = () => finish(reject, signal.reason);
    signal?.addEventListener("abort", cancel, { once: true });
    entry.promise.then(data => finish(resolve, data), error => finish(reject, error));
  });
}
