"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readArtifactTextDraft, writeArtifactTextDraft } from "@/lib/creation/client/drafts";
import { createPendingTextJournal, pendingTextSnapshot } from "@/lib/creation/client/pending-text";
import { useEditorReadiness } from "./useEditorReadiness";

export function usePendingTextDraft(userId, artifactId, persistOperations, draftSessionId, snapshotValue = pendingTextSnapshot) {
  const current = useRef(null), barrier = useRef(persistOperations);
  const { ready, setReady, isReady } = useEditorReadiness();
  const [state, setState] = useState({ ready: false, recovery: null, error: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { barrier.current = persistOperations; }, [persistOperations]);
  useEffect(() => {
    let alive = true;
    setReady(false);
    const report = error => { if (alive) setState(value => ({ ...value, error })); };
    const journal = createPendingTextJournal({
      snapshot: snapshotValue,
      write: (value, prepare) => writeArtifactTextDraft(userId, artifactId, value, prepare, draftSessionId),
      beforeClear: () => barrier.current(), onError: report,
      onSaved: latest => { if (alive && latest) setState(value => value.error ? { ...value, error: null } : value); },
    });
    current.current = journal;
    // Disable new input until this read finishes, so it cannot replace a
    // recoverable draft while IndexedDB is still opening.
    readArtifactTextDraft(userId, artifactId, draftSessionId).then(value => {
      const recovery = snapshotValue(value);
      if (alive) { journal.seed(recovery); setState({ recovery, error: null }); setReady(true); }
    }).catch(error => {
      // Keep cloud editing available when local persistence is unavailable;
      // the warning remains visible and every local write reports the error.
      if (alive) { error.code ||= "LOCAL_DRAFT_UNAVAILABLE"; report(error); setReady(true); }
    });
    const persist = () => { void journal.flush().catch(report); };
    const hidden = () => { if (document.visibilityState === "hidden") persist(); };
    window.addEventListener("pagehide", persist);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      alive = false; void journal.close().catch(() => {});
      setReady(false);
      window.removeEventListener("pagehide", persist);
      document.removeEventListener("visibilitychange", hidden);
      if (current.current === journal) current.current = null;
    };
  }, [userId, artifactId, draftSessionId, attempt, setReady, snapshotValue]);
  const change = useCallback(value => { if (!isReady()) throw new Error("TEXT_DRAFT_REVIEW_REQUIRED"); current.current?.change(value); }, [isReady]);
  const snapshot = useCallback(() => current.current?.snapshot() ?? null, []);
  const flush = useCallback(() => current.current?.flush() ?? Promise.resolve(), []);
  const clear = useCallback(async () => {
    const journal = current.current;
    journal?.change(null); await journal?.flush();
    if (current.current === journal) setState(value => ({ ...value, recovery: null, error: null }));
  }, []);
  const retry = useCallback(() => {
    if (state.error || !ready) setAttempt(value => value + 1);
    else void flush().catch(error => setState(value => ({ ...value, error })));
  }, [state.error, ready, flush]);
  // A source editor can resume an unfinished draft without committing invalid
  // intermediate code. Keep the recovery record until its later commit.
  const acceptRecovery = useCallback(() => setState(value => ({ ...value, recovery: null })), []);
  const reviewPending = useCallback(() => {
    const recovery = current.current?.snapshot();
    if (recovery) setState(value => ({ ...value, recovery }));
  }, []);
  return { ...state, ready, change, flush, clear, retry, snapshot, acceptRecovery, reviewPending };
}
