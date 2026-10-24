"use client";

import { useState, useSyncExternalStore } from "react";

// Loading a local editing session is an external lifecycle: React Activity can
// disconnect effects while preserving component state. A snapshot subscription
// makes readiness false during that gap, before the retained editor reappears.
export function useEditorReadiness() {
  const [store] = useState(() => {
    let ready = false;
    const listeners = new Set();
    return {
      get: () => ready,
      server: () => false,
      subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
      set: value => { if (ready !== value) { ready = value; for (const listener of listeners) listener(); } },
    };
  });
  const ready = useSyncExternalStore(store.subscribe, store.get, store.server);
  return { ready, setReady: store.set, isReady: store.get };
}
