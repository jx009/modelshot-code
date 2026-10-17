/** Bound simultaneous downloads/decodes; cached callers share one queue entry. */
export function createImageQueue(limit = 4) {
  let active = 0;
  const pending = [];
  function drain() {
    while (active < limit && pending.length) {
      const { run, resolve, reject } = pending.shift();
      active++;
      Promise.resolve().then(run).then(resolve, reject).finally(() => { active--; drain(); });
    }
  }
  return run => new Promise((resolve, reject) => { pending.push({ run, resolve, reject }); drain(); });
}
