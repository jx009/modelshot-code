// Authorization/revocation is checked by the caller on every request. Only
// immutable checksummed bytes are cached; no signed URLs or user permissions.
export function createPublicResourceCache({ maxBytes = 32 * 1024 * 1024, maxEntries = 64, concurrency = 2, maxPending = 32, ttl = 60000 } = {}) {
  const entries = new Map(), inflight = new Map(), waiting = [];
  let bytes = 0, active = 0;
  const remove = (key, row) => { entries.delete(key); bytes -= row.value.length; };
  const drain = () => { while (active < concurrency && waiting.length) { active++; waiting.shift()(); } };
  return async function read(key, load) {
    const now = Date.now();
    for (const [oldKey, row] of entries) if (row.expires <= now) remove(oldKey, row);
    const found = entries.get(key); if (found) return found.value;
    if (inflight.has(key)) return inflight.get(key);
    if (waiting.length + active >= maxPending) { const error = new Error("WEB_PUBLICATION_BUSY"); error.code = "WEB_PUBLICATION_BUSY"; throw error; }
    const task = (async () => {
      await new Promise(resolve => { waiting.push(resolve); drain(); });
      try {
        const value = await load();
        if (value.length <= maxBytes) {
          while (entries.size && (bytes + value.length > maxBytes || entries.size >= maxEntries)) { const [oldKey, row] = entries.entries().next().value; remove(oldKey, row); }
          entries.set(key, { value, expires: Date.now() + ttl }); bytes += value.length;
        }
        return value;
      } finally { active--; drain(); }
    })();
    inflight.set(key, task);
    try { return await task; } finally { inflight.delete(key); }
  };
}
