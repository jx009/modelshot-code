"use client";

import { useEffect } from "react";

// Run events supply a revision target; retry only while that target is pending.
// The journal checks both before and after the GET that local edits are safe.
export function useLiveArtifactRevision({ target, revision, ready, status, refreshRemote, canApply }) {
  useEffect(() => {
    if (!ready || status !== "saved" || !Number.isInteger(target) || target <= revision) return;
    const controller = new AbortController();
    let timer, failures = 0;
    async function sync() {
      let delay = 1000;
      try {
        if (await refreshRemote(target, { canApply, signal: controller.signal })) return;
        failures = 0;
      } catch {
        // Keep the visible canvas usable during a transient read failure.
        delay = Math.min(30000, 2000 * 2 ** Math.min(failures++, 4));
      }
      if (!controller.signal.aborted) timer = setTimeout(sync, delay);
    }
    void sync();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [target, revision, ready, status, refreshRemote, canApply]);
}
