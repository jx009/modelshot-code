"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client-api";

export function useRemoteResource(url) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState(null);
  const key = `${url}:${revision}`;

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    api(url, { signal: controller.signal })
      .then(data => {
        if (!controller.signal.aborted) setResult({ key, url, data, error: null });
      })
      .catch(error => {
        if (!controller.signal.aborted) setResult(previous => ({ key, url, data: ![401, 403].includes(error.status) && previous?.url === url ? previous.data : null, error }));
      });
    return () => controller.abort();
  }, [url, key]);

  const reload = useCallback(() => setRevision(value => value + 1), []);
  const current = result?.key === key;
  return {
    data: result?.url === url ? result.data : null,
    error: current ? result.error : null,
    loading: Boolean(url) && !current && !(result?.url === url && result.data != null),
    refreshing: Boolean(url) && !current,
    reload,
  };
}
