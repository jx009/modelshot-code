// No editor imports, subscriptions or work on ordinary pages. Guards exist only
// while an editing workspace is mounted; the no-guard path stays synchronous.
const guards = new Set();
let pending = null, continuing = false;
let stopHistoryGuard = null;

// A cancellable Navigation API event arrives before popstate/React unmounts.
// Cancel first, save in place, then replay the exact entry (URLs need not be
// unique). Do not push sentinel entries or overwrite Next's history state.
function watchHistory() {
  const navigation = globalThis.window?.navigation;
  if (!navigation?.addEventListener || !navigation.traverseTo) return null;
  let replay = null;
  const onNavigate = event => {
    const from = navigation.currentEntry?.key, to = event.destination?.key;
    if (replay && replay.from === from && replay.to === to && event.navigationType === "traverse") {
      replay = null; // Only this one traversal may bypass the save guard.
      return;
    }
    if (!hasNavigationGuard() || event.navigationType !== "traverse" ||
      !event.cancelable || !event.destination?.sameDocument || !from || !to) return;
    event.preventDefault();
    deferNavigation(async () => {
      if (navigation.currentEntry?.key !== from) return;
      const ticket = { from, to };
      replay = ticket;
      try {
        const result = navigation.traverseTo(to);
        // Both promises can reject. Observe both immediately, including when
        // another navigation cancels the replay before it commits.
        await Promise.all([result.committed, result.finished]);
      } finally { if (replay === ticket) replay = null; }
    });
  };
  navigation.addEventListener("navigate", onNavigate);
  return () => { replay = null; navigation.removeEventListener("navigate", onNavigate); };
}

export function registerNavigationGuard(guard) {
  guards.add(guard);
  if (guards.size === 1) stopHistoryGuard = watchHistory();
  return () => {
    guards.delete(guard);
    if (pending?.guards.includes(guard)) { pending.cancelled = true; pending = null; }
    if (!guards.size) { stopHistoryGuard?.(); stopHistoryGuard = null; }
  };
}
export function hasNavigationGuard() { return !continuing && guards.size > 0; }

// true means the caller must prevent its immediate transition. This owns the
// continuation, so neither duplicate clicks nor a stale/unmounted guard routes.
export function deferNavigation(proceed) {
  if (!hasNavigationGuard()) return false;
  if (pending) return true;
  const task = { guards: [...guards], cancelled: false, from: globalThis.location?.href, entry: globalThis.window?.navigation?.currentEntry?.key };
  pending = task;
  void (async () => {
    let current;
    try {
      for (const guard of task.guards) {
        if (task.cancelled || !guards.has(guard)) return;
        current = guard;
        await guard.prepare();
      }
      if (task.cancelled || task.from !== globalThis.location?.href || task.entry !== globalThis.window?.navigation?.currentEntry?.key || task.guards.some(guard => !guards.has(guard))) return;
      continuing = true;
      let result;
      try { result = proceed(); } finally { continuing = false; }
      await result;
    } catch (error) {
      if (!task.cancelled && current && guards.has(current)) { try { current.onError?.(error); } catch { /* Reporting must not leak a rejected navigation. */ } }
    } finally {
      for (const guard of task.guards) { try { guard.finish?.(); } catch { /* Always release the remaining guards. */ } }
      if (pending === task) pending = null;
    }
  })();
  return true;
}
