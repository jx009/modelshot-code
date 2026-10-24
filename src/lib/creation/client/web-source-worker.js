import { sourceTaskPayload, WEB_SOURCE_CHANNEL } from "../web-source-protocol.js";

const error = code => new Error(code);
// One parser worker at a time per app module, at most two waiting tasks. Each
// worker has a single request and is terminated after success or failure so
// parsed user content does not remain in a global worker cache.
export function createWebSourceRunner({ createWorker, timeoutMs = 15000 } = {}) {
  let active = null, sequence = 0;
  const queue = [];
  function pump() {
    if (active || !queue.length) return;
    const job = queue.shift(); active = job;
    try {
      job.worker = createWorker();
      job.worker.onmessage = event => {
        const message = event.data;
        if (!message || message.channel !== WEB_SOURCE_CHANNEL || message.id !== job.id || message.type !== job.type || typeof message.ok !== "boolean") { job.finish(error("WEB_SOURCE_WORKER_PROTOCOL")); return; }
        if (!message.ok) { job.finish(error(/^(?:WEB|LAYOUT|ARTIFACT)_[A-Z_]+$/.test(message.error || "") ? message.error : "WEB_SOURCE_WORKER_FAILED")); return; }
        job.finish(null, message.result);
      };
      job.worker.onerror = () => job.finish(error("WEB_SOURCE_WORKER_FAILED"));
      job.worker.onmessageerror = () => job.finish(error("WEB_SOURCE_WORKER_PROTOCOL"));
      job.worker.postMessage({ channel: WEB_SOURCE_CHANNEL, id: job.id, type: job.type, payload: job.payload });
      job.payload = null;
    } catch { job.finish(error("WEB_SOURCE_WORKER_UNAVAILABLE")); }
  }
  return function run(type, payload, { signal } = {}) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(error("ARTIFACT_CLOSED")); return; }
      if (active && queue.length >= 2) { reject(error("WEB_SOURCE_WORKER_BUSY")); return; }
      let cleaned;
      try { cleaned = sourceTaskPayload(type, payload); } catch (failure) { reject(failure); return; }
      const job = { id: ++sequence, type, payload: cleaned, worker: null, done: false, timer: null };
      const aborted = () => job.finish(error("ARTIFACT_CLOSED"));
      job.finish = (failure, result) => {
        if (job.done) return;
        job.done = true; clearTimeout(job.timer); signal?.removeEventListener("abort", aborted);
        if (job.worker) { job.worker.onmessage = null; job.worker.onerror = null; job.worker.onmessageerror = null; job.worker.terminate(); }
        job.payload = null;
        if (active === job) active = null;
        else { const index = queue.indexOf(job); if (index >= 0) queue.splice(index, 1); }
        if (failure) reject(failure); else resolve(result);
        queueMicrotask(pump);
      };
      // Queue time counts toward the deadline; abandoned tabs cannot leave
      // tasks and their source snapshots waiting without a bound.
      job.timer = setTimeout(() => job.finish(error("WEB_SOURCE_WORKER_TIMEOUT")), timeoutMs);
      signal?.addEventListener("abort", aborted, { once: true });
      queue.push(job); pump();
    });
  };
}
export const runWebSourceTask = createWebSourceRunner({
  createWorker: () => new Worker(new URL("../../../workers/creation-web-source.worker.js", import.meta.url), { type: "module" }),
});
