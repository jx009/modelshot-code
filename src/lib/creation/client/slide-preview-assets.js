import { loadWebPreviewAssets } from "./web-preview-assets.js";

// One viewer owns this bounded cache and request queue. Adjacent slides share
// image reads; scrolling back does not refetch already decoded raster data.
export function createSlidePreviewAssets(fetchImages = loadWebPreviewAssets) {
  const cache = new Map(), pending = new Map(), queue = [];
  let bytes = 0, active = 0;
  const limit = 6 * 1024 * 1024;
  function remember(id, url) {
    const size = Math.ceil(url.length * 3 / 4);
    while (cache.size && (bytes + size > limit || cache.size >= 20)) {
      const oldest = cache.keys().next().value; bytes -= cache.get(oldest).size; cache.delete(oldest);
    }
    if (size <= limit) { cache.set(id, { url, size }); bytes += size; }
  }
  function pump() {
    while (active < 2 && queue.length) {
      const job = queue.shift();
      if (job.controller.signal.aborted) {
        if (pending.get(job.id) === job) pending.delete(job.id);
        job.reject(job.controller.signal.reason); continue;
      }
      active++;
      void fetchImages([job.id], { signal: job.controller.signal }).then(images => {
        job.controller.signal.throwIfAborted();
        const url = images.get(job.id);
        if (!url) throw new Error("WEB_PREVIEW_ASSET_UNAVAILABLE");
        remember(job.id, url); job.resolve(url);
      }).catch(job.reject).finally(() => { active--; if (pending.get(job.id) === job) pending.delete(job.id); pump(); });
    }
  }
  function acquire(id, signal) {
    signal?.throwIfAborted();
    const saved = cache.get(id);
    if (saved) { cache.delete(id); cache.set(id, saved); return Promise.resolve(saved.url); }
    let job = pending.get(id);
    if (!job || job.controller.signal.aborted) {
      job = { id, controller: new AbortController(), users: 0 };
      job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
      pending.set(id, job); queue.push(job);
    }
    job.users++;
    const result = new Promise((resolve, reject) => {
      let finished = false;
      const done = (handler, value) => {
        if (finished) return; finished = true; signal?.removeEventListener("abort", cancel); job.users--;
        if (!job.users && pending.get(id) === job) job.controller.abort();
        handler(value);
      };
      const cancel = () => done(reject, signal.reason);
      signal?.addEventListener("abort", cancel, { once: true });
      job.promise.then(url => done(resolve, url), error => done(reject, error));
    });
    pump(); return result;
  }
  return {
    async read(ids, { signal, onImage } = {}) {
      const results = await Promise.allSettled([...new Set(ids)].map(async id => { const url = await acquire(id, signal); signal?.throwIfAborted(); onImage?.(id, url); return [id, url]; }));
      const failure = results.find(result => result.status === "rejected");
      if (failure) throw failure.reason;
      return new Map(results.map(result => result.value));
    },
    clear() { for (const job of pending.values()) job.controller.abort(); cache.clear(); bytes = 0; },
  };
}
