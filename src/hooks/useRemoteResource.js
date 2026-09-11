"use client";

import { useCallback, useEffect, useState } from "react";

export function useRemoteResource(url) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState(null);
  const key = `${url}:${revision}`;

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(`Request failed (${response.status})`);
        return response.json();
      })
      .then(data => {
        if (!controller.signal.aborted) setResult({ key, url, data, error: null });
      })
      .catch(error => {
        if (!controller.signal.aborted) setResult(previous => ({ key, url, data: previous?.url === url ? previous.data : null, error }));
      });
    return () => controller.abort();
  }, [url, key]);

  const reload = useCallback(() => setRevision(value => value + 1), []);
  const current = result?.key === key;
  return {
    data: result?.url === url ? result.data : null,
    error: current ? result.error : null,
    loading: Boolean(url) && !current,
    reload,
  };
}
