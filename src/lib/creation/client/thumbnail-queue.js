// One queue/cache per mounted editor. Weak keys do not retain old page graphs.
export function createThumbnailQueue(render, { maxEntries = 32, maxBytes = 8 * 1024 * 1024, maxPending = 16 } = {}) {
  const snapshots = new WeakMap(), cached = new Map(), waiting = [], lifetime = new AbortController();
  let active = false, bytes = 0, serial = 0;
  function evict(key, entry) {
    cached.delete(key); bytes -= entry.result.blob.size; entry.live = false;
    // Undo history may still retain the page used as a WeakMap key. Release
    // the blob itself on eviction, not only its entry in the LRU map.
    entry.result = null;
  }
  function remember(page, result) {
    if (result.missingImages || result.blob.size > maxBytes) return;
    const previous = snapshots.get(page);
    if (previous?.live) evict(previous.key, previous);
    while (cached.size && (cached.size >= maxEntries || bytes + result.blob.size > maxBytes)) evict(...cached.entries().next().value);
    const entry = { key: ++serial, result, live: true };
    snapshots.set(page, entry); cached.set(entry.key, entry); bytes += result.blob.size;
  }
  async function pump() {
    if (active) return;
    active = true;
    try {
      while (waiting.length) {
        const job = waiting.shift();
        try {
          job.signal.throwIfAborted();
          const result = await render(job.page, job.signal);
          job.signal.throwIfAborted();
          remember(job.page, result); job.resolve(result);
        } catch (error) { job.reject(error); }
        finally { job.signal.removeEventListener("abort", job.cancel); }
      }
    } finally { active = false; }
  }
  return {
    read(page, signal) {
      if (lifetime.signal.aborted || signal?.aborted) return Promise.reject(signal?.reason || lifetime.signal.reason);
      const entry = snapshots.get(page);
      if (entry?.live) { cached.delete(entry.key); cached.set(entry.key, entry); return Promise.resolve(entry.result); }
      if (waiting.length >= maxPending) return Promise.reject(new Error("THUMBNAIL_QUEUE_FULL"));
      return new Promise((resolve, reject) => {
        const combined = AbortSignal.any([lifetime.signal, ...(signal ? [signal] : [])]);
        const job = { page, signal: combined, resolve, reject, cancel: () => {
          const index = waiting.indexOf(job);
          if (index >= 0) waiting.splice(index, 1);
          reject(combined.reason);
        } };
        combined.addEventListener("abort", job.cancel, { once: true });
        waiting.push(job); void pump();
      });
    },
    dispose() {
      lifetime.abort();
      for (const [key, entry] of cached) evict(key, entry);
    },
  };
}
