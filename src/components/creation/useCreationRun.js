"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client-api";

const active = status => ["queued", "running", "cancelling"].includes(status);
export function useCreationRun(runId, onChange, refreshKey = 0) {
  const [state, setState] = useState({ run: null, error: null });
  const callback = useRef(onChange);
  useEffect(() => { callback.current = onChange; }, [onChange]);
  useEffect(() => {
    if (!runId) return;
    let disposed = false, stream, timer, request, reading = false, again = false, cursor = 0, retry = 2000;
    let running = true;
    const closeStream = () => { stream?.close(); stream = undefined; };
    function schedule(delay) {
      clearTimeout(timer);
      if (!disposed && document.visibilityState !== "hidden" && running) timer = setTimeout(refresh, delay);
    }
    function notified(delay) {
      // Keep a notification received during a GET; its completion must not
      // replace the immediate follow-up with the 20-second reconciliation timer.
      if (reading) again = true;
      else schedule(delay);
    }
    function connect() {
      if (disposed || stream || !running || document.visibilityState === "hidden") return;
      stream = new EventSource(`/api/creation/runs/${encodeURIComponent(runId)}/events?after=${cursor}`);
      stream.addEventListener("creation", event => {
        try {
          const row = JSON.parse(event.data);
          if (Number.isInteger(row.sequence) && row.sequence > cursor) {
            cursor = row.sequence;
            notified(80);
          }
        } catch { closeStream(); schedule(2000); }
      });
      stream.addEventListener("reset", () => { closeStream(); cursor = 0; notified(0); });
      stream.addEventListener("settled", () => { closeStream(); notified(0); });
      stream.onerror = () => {
        closeStream();
        schedule(retry + Math.floor(Math.random() * 500));
        retry = Math.min(30000, retry * 2);
      };
    }
    async function refresh() {
      if (disposed || document.visibilityState === "hidden") return;
      if (reading) { again = true; return; }
      reading = true;
      request = new AbortController();
      try {
        const run = await api(`/api/creation/runs/${encodeURIComponent(runId)}`, { signal: request.signal });
        if (disposed || request.signal.aborted) return;
        running = active(run.status);
        cursor = Math.max(cursor, run.eventSequence);
        setState({ run, error: null });
        callback.current?.(run);
        retry = 2000;
        // A connected-but-silent SSE can miss a notification behind a proxy.
        // Reconcile active jobs periodically; visibility/terminal states stop it.
        if (running) { connect(); schedule(20000); } else { clearTimeout(timer); closeStream(); }
      } catch (error) {
        if (disposed || request.signal.aborted) return;
        setState(current => ({ ...current, error }));
        closeStream();
        if ([401, 403, 404].includes(error.status)) running = false;
        else { schedule(retry); retry = Math.min(30000, retry * 2); }
      } finally {
        reading = false;
        if (again && !disposed) { again = false; schedule(0); }
      }
    }
    const visibility = () => {
      clearTimeout(timer);
      if (document.visibilityState === "hidden") { closeStream(); request?.abort(); }
      else { running = true; void refresh(); }
    };
    document.addEventListener("visibilitychange", visibility);
    void refresh();
    return () => { disposed = true; closeStream(); clearTimeout(timer); request?.abort(); document.removeEventListener("visibilitychange", visibility); };
  }, [runId, refreshKey]);
  return state;
}
