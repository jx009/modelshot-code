"use client";

import { startTransition, useEffect } from "react";
import { api } from "@/lib/client-api";

const TERMINAL = ["succeeded", "failed", "cancelled"];

export function useStudioJobs({ documentId, ready, userId, revision, onJobs, onResult, onUsage }) {
  useEffect(() => {
    if (!documentId || !ready || !userId) return;
    const abort = new AbortController();
    let timer, stream, streamActive = false, snapshotSignature = "", statusSignature = "";
    function receive(rows) {
      if (abort.signal.aborted || !Array.isArray(rows)) return;
      const nextRows = rows.map(row => `${row.id}:${row.status}:${row.errorCode || ""}:${row.cancelRequested ? 1 : 0}:${row.updatedAt || ""}:${row.resultData?.assets?.map(asset => asset.id).join(",") || ""}:${row.resultData?.text?.length || 0}`).join("|");
      if (snapshotSignature !== nextRows) {
        snapshotSignature = nextRows;
        startTransition(() => onJobs(rows));
      }
      rows.toReversed().forEach(job => { onResult(job).catch(() => {}); });
      const nextStatus = rows.map(row => `${row.id}:${row.status}`).join("|");
      if (statusSignature !== nextStatus) {
        statusSignature = nextStatus;
        api("/api/usage", { signal: abort.signal }).then(value => { if (!abort.signal.aborted) onUsage(value); }).catch(() => {});
      }
      const active = rows.some(row => !TERMINAL.includes(row.status));
      if (!active) { stream?.close(); streamActive = false; clearTimeout(timer); }
      return active;
    }
    async function poll() {
      try {
        const rows = await api(`/api/studio/jobs?documentId=${encodeURIComponent(documentId)}&recover=1`, { signal: abort.signal });
        if (!receive(rows)) return;
      } catch { if (abort.signal.aborted) return; }
      if (!abort.signal.aborted && !streamActive) timer = setTimeout(poll, 4000);
    }
    async function start() {
      try {
        const rows = await api(`/api/studio/jobs?documentId=${encodeURIComponent(documentId)}&recover=1`, { signal: abort.signal });
        if (!receive(rows) || abort.signal.aborted) return;
        stream = new EventSource(`/api/studio/events?documentId=${encodeURIComponent(documentId)}`);
        streamActive = true;
        stream.addEventListener("jobs", event => { try { receive(JSON.parse(event.data)); } catch {} });
        stream.onerror = () => { stream.close(); streamActive = false; clearTimeout(timer); if (!abort.signal.aborted) timer = setTimeout(poll, 2000); };
      } catch { if (!abort.signal.aborted) timer = setTimeout(poll, 4000); }
    }
    start();
    return () => { abort.abort(); stream?.close(); clearTimeout(timer); };
  }, [documentId, ready, userId, revision, onJobs, onResult, onUsage]);
}
