const CACHE_MS = 30_000;
let snapshot;
let savedAt = 0;
let pending;

export function invalidateAdminStatsCache() {
  snapshot = undefined;
  savedAt = 0;
  pending = undefined;
}

export async function readAdminStats(load) {
  if (snapshot && Date.now() - savedAt < CACHE_MS) return snapshot;
  if (pending) return pending;
  const task = load();
  pending = task;
  try {
    const data = await task;
    if (pending === task) {
      snapshot = data;
      savedAt = Date.now();
    }
    return data;
  } finally {
    if (pending === task) pending = undefined;
  }
}
