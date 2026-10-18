/** Bound simultaneous downloads/decodes; cached callers share one queue entry. */
export function createImageQueue(limit = 4) {
  let active = 0;
  const pending = [];
  function drain() {
    while (active < limit && pending.length) {
      const { run, resolve, reject, signal, abort } = pending.shift();
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) { reject(signal.reason); continue; }
      active++;
      Promise.resolve().then(() => { if (signal?.aborted) throw signal.reason; return run(); }).then(resolve, reject).finally(() => { active--; drain(); });
    }
  }
  return (run, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const entry = { run, resolve, reject, signal };
    entry.abort = () => {
      const index = pending.indexOf(entry);
      if (index !== -1) pending.splice(index, 1);
      signal.removeEventListener("abort", entry.abort);
      reject(signal.reason);
    };
    signal?.addEventListener("abort", entry.abort, { once: true });
    pending.push(entry); drain();
  });
}
