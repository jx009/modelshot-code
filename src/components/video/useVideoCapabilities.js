"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";

export default function useVideoCapabilities(enabled = true) {
  const [data, setData] = useState(null), [error, setError] = useState(null), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    api("/api/video/capabilities", { signal: abort.signal, timeoutMs: 15000 }).then(value => { if (!abort.signal.aborted) { setData(value); setError(null); } }).catch(failure => { if (!abort.signal.aborted) setError(failure.message); });
    return () => abort.abort();
  }, [enabled, attempt]);
  return { data, error, loading: enabled && !data && !error, retry() { setData(null); setError(null); setAttempt(value => value + 1); } };
}
