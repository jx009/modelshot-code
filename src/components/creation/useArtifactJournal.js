"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, requestKey } from "@/lib/client-api";
import { assertLayoutJournalCapacity, nextLayoutOperationBatch } from "@/lib/creation/layout-journal";
import { readArtifactDraft, writeArtifactDraft } from "@/lib/creation/client/drafts";
import { invalidateProjectLists } from "@/lib/studio/project-list";
import { useEditorReadiness } from "./useEditorReadiness";
import { reconcileArtwork } from "@/lib/creation/client/reconcile-artwork";

function draftOf(current) {
  return { baseRevision: current.baseRevision, content: current.content, operations: [...current.operations], inflight: current.inflight, copyRequest: current.copyRequest || null, restoreRequest: current.restoreRequest || null };
}

// The editor owns high-frequency gesture state. Only completed edits reach
// this hook, which journals operations and serializes network saves.
export function useArtifactJournal(userId, artifactId, draftSessionId, codec) {
  const { ready: sessionReady, setReady } = useEditorReadiness();
  const [view, setView] = useState({ content: null, revision: null, status: "loading", error: null, undo: 0, redo: 0 });
  const model = useRef(null), generation = useRef(0), timer = useRef(null), localTimer = useRef(null);
  const [reload, setReload] = useState(0);
  const paint = useCallback(() => {
    const current = model.current;
    if (!current) return;
    setView({ identity: `${current.userId}:${current.artifactId}`, content: current.content, revision: current.baseRevision, status: current.status, error: current.error,
      ready: true, copyPending: Boolean(current.copyRequest), restorePending: current.restoreRequest || null, unsaved: Boolean(current.operations.length || current.inflight || current.copyRequest || current.restoreRequest), undo: current.past.length, redo: current.future.length });
  }, []);
  const persist = useCallback(async () => {
    clearTimeout(localTimer.current);
    const current = model.current;
    if (!current?.content) return;
    return writeArtifactDraft(current.userId, current.artifactId, draftOf(current), current.draftSessionId);
  }, []);
  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const current = model.current, epoch = generation.current;
    if (!current?.content || current.restoreRequest || ["loading", "conflict", "copying"].includes(current.status)) throw new Error("ARTIFACT_NOT_READY");
    if (current.saving) return current.saving;
    const task = async () => {
      current.status = "saving"; current.error = null; paint();
      while (current.operations.length || current.inflight) {
        if (epoch !== generation.current) throw new Error("ARTIFACT_CLOSED");
        if (!current.inflight) current.inflight = { baseRevision: current.baseRevision, saveKey: requestKey(), operations: nextLayoutOperationBatch(current.operations) };
        // Unknown POST outcomes are recovered using this exact body after reload.
        await persist();
        if (epoch !== generation.current) throw new Error("ARTIFACT_CLOSED");
        const body = current.inflight;
        const saved = await api(codec.savePath(current.artifactId), { method: codec.saveMethod, body, timeoutMs: 30000 });
        if (epoch !== generation.current) return saved;
        current.operations.splice(0, body.operations.length);
        current.baseRevision = saved.revision;
        invalidateProjectLists(current.userId);
        current.inflight = null;
        await persist();
      }
      current.status = "saved"; current.firstDirtyAt = null; paint();
      return { revision: current.baseRevision, content: current.content };
    };
    current.saving = task().catch(error => {
      if (epoch === generation.current) { current.status = error.code === "ARTIFACT_VERSION_CONFLICT" ? "conflict" : "error"; current.error = error; paint(); }
      throw error;
    }).finally(() => { current.saving = null; });
    return current.saving;
  }, [paint, persist, codec]);
  const refreshRemote = useCallback(async (minimumRevision, { canApply = () => true, signal } = {}) => {
    const current = model.current, epoch = generation.current;
    const clean = () => model.current === current && epoch === generation.current && !signal?.aborted
      && current?.status === "saved" && !current.saving && !current.operations.length
      && !current.inflight && !current.copyRequest && !current.restoreRequest && canApply();
    if (!current || !Number.isInteger(minimumRevision)) return false;
    if (current.baseRevision >= minimumRevision) return true;
    if (!clean()) return false;
    const baseRevision = current.baseRevision, content = current.content;
    const remote = await api(codec.readPath(current.artifactId), { signal, timeoutMs: 30000 });
    // Edits, saves, another refresh, or a new editor session may have arrived
    // while this GET was pending. Never replace their state with this response.
    if (!clean() || current.baseRevision !== baseRevision || current.content !== content) return false;
    if (!Number.isInteger(remote.revision) || remote.revision < minimumRevision || !remote.content) return false;
    current.content = reconcileArtwork(current.content, remote.content); current.baseRevision = remote.revision;
    current.past = []; current.future = []; current.error = null;
    paint();
    // No await between the final guard and replacing the clean snapshot. Draft
    // persistence is serialized separately and must not block cloud updates.
    void persist().catch(() => {});
    return true;
  }, [codec, paint, persist]);
  useEffect(() => {
    const epoch = ++generation.current, abort = new AbortController();
    model.current = null;
    setReady(false);
    if (!userId || !artifactId) return () => abort.abort();
    async function load() {
      // Overlap cloud I/O with local recovery reads. If recovery performs a
      // write, discard this speculative snapshot and read the committed result.
      const openingRead = api(codec.readPath(artifactId), { signal: abort.signal }).then(value => ({ value }), error => ({ error }));
      let recoveredWrite = false;
      let draft;
      try { draft = await readArtifactDraft(userId, artifactId, draftSessionId); }
      catch (error) {
        // Local recovery is an enhancement. A blocked/private browsing
        // IndexedDB must not prevent opening the authoritative cloud version.
        draft = null;
        error.code ||= "LOCAL_DRAFT_UNAVAILABLE";
        if (epoch === generation.current) setView(current => ({ ...current, error }));
      }
      if (abort.signal.aborted) return;
      if (draft?.restoreRequest) {
        recoveredWrite = true;
        if (!codec.restorePath) throw new Error("ARTIFACT_FORMAT_UNSUPPORTED");
        // A lost response is retried with the persisted exact key, including
        // after remount. Do not create a second restore revision.
        let saved;
        try { saved = await api(codec.restorePath(artifactId), { method: "POST", body: draft.restoreRequest, signal: abort.signal }); }
        catch (error) { if (error.code !== "ARTIFACT_VERSION_CONFLICT") throw error; }
        // A confirmed CAS rejection means no restore was committed. Reload the
        // latest cloud revision; only uncertain outcomes keep a retry journal.
        draft = { ...draft, baseRevision: saved?.revision || draft.baseRevision, operations: [], inflight: null, restoreRequest: null };
        await writeArtifactDraft(userId, artifactId, draft, draftSessionId);
      }
      if (draft?.content) setView({ identity: `${userId}:${artifactId}`, content: draft.content, revision: draft.baseRevision, status: "loading", error: null, undo: 0, redo: 0 });
      if (draft?.inflight && !draft.copyRequest) {
        recoveredWrite = true;
        try {
          const saved = await api(codec.savePath(artifactId), { method: codec.saveMethod, body: draft.inflight, signal: abort.signal });
          draft = { ...draft, baseRevision: saved.revision, operations: draft.operations.slice(draft.inflight.operations.length), inflight: null };
          await writeArtifactDraft(userId, artifactId, draft, draftSessionId);
        } catch (error) { if (abort.signal.aborted) return; if (error.code !== "ARTIFACT_VERSION_CONFLICT") throw error; }
      }
      const opening = recoveredWrite ? { value: await api(codec.readPath(artifactId), { signal: abort.signal }) } : await openingRead;
      if (opening.error) throw opening.error;
      const remote = opening.value;
      if (abort.signal.aborted || epoch !== generation.current) return;
      const dirty = Boolean(draft?.operations?.length || draft?.inflight || draft?.copyRequest);
      const conflict = dirty && (Boolean(draft.copyRequest) || draft.baseRevision !== remote.revision);
      const content = conflict ? draft.content : dirty ? codec.apply(remote.content, draft.operations) : remote.content;
      model.current = { userId, artifactId, draftSessionId, baseRevision: dirty ? draft.baseRevision : remote.revision, content,
        operations: dirty ? [...draft.operations] : [], inflight: dirty ? draft.inflight : null,
        copyRequest: dirty ? draft.copyRequest : null,
        status: conflict ? "conflict" : dirty ? "local" : "saved", error: null, past: [], future: [], saving: null };
      paint();
      setReady(true);
      if (dirty && !conflict) timer.current = setTimeout(() => void flush().catch(() => {}), 1200);
    }
    load().catch(error => {
      if (!abort.signal.aborted && epoch === generation.current) setView(current => ({
        ...(current.identity === `${userId}:${artifactId}` ? current : { content: null, revision: null, undo: 0, redo: 0 }),
        identity: `${userId}:${artifactId}`, status: "error", error, ready: false,
      }));
    });
    const online = () => { if (model.current?.operations.length && !["conflict", "copying"].includes(model.current.status)) void flush().catch(() => {}); };
    const hide = () => {
      if (model.current?.operations.length || model.current?.inflight || model.current?.copyRequest) void persist().catch(() => {});
    };
    const visibility = () => { if (document.visibilityState === "hidden") hide(); };
    window.addEventListener("online", online); window.addEventListener("pagehide", hide);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      void persist().catch(() => {});
      generation.current = epoch + 1; abort.abort(); clearTimeout(timer.current); clearTimeout(localTimer.current);
      setReady(false);
      window.removeEventListener("online", online); window.removeEventListener("pagehide", hide);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [userId, artifactId, draftSessionId, reload, paint, persist, flush, setReady, codec]);

  const change = useCallback((operations, mode = "edit") => {
    const current = model.current;
    if (!current?.content || current.restoreRequest || ["conflict", "loading", "copying"].includes(current.status)) return false;
    assertLayoutJournalCapacity(current.operations, operations);
    const result = codec.applyWithInverse(current.content, operations);
    if (mode === "edit") { current.past = codec.limitHistory([...current.past, result.inverse]); current.future = []; }
    else if (mode === "undo") current.future = codec.limitHistory([...current.future, result.inverse]);
    else current.past = codec.limitHistory([...current.past, result.inverse]);
    current.content = result.document; current.operations.push(...operations);
    current.firstDirtyAt ??= Date.now();
    if (!current.saving) current.status = "local";
    paint();
    clearTimeout(localTimer.current);
    localTimer.current = setTimeout(() => { void persist().catch(error => { current.error = error; paint(); }); }, 180);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush().catch(() => {}), Math.max(0, Math.min(1200, 5000 - (Date.now() - current.firstDirtyAt))));
    return true;
  }, [paint, persist, flush, codec]);
  const undo = useCallback(() => {
    const current = model.current, ops = current?.past.at(-1);
    if (ops && change(ops, "undo")) { current.past.pop(); paint(); }
  }, [change, paint]);
  const redo = useCallback(() => {
    const current = model.current, ops = current?.future.at(-1);
    if (ops && change(ops, "redo")) { current.future.pop(); paint(); }
  }, [change, paint]);
  const saveConflictCopy = useCallback(async (title, pendingText) => {
    const current = model.current, epoch = generation.current;
    if (!current || current.status !== "conflict") throw new Error("ARTIFACT_NOT_IN_CONFLICT");
    clearTimeout(timer.current); clearTimeout(localTimer.current);
    if (!current.copyRequest) {
      // A failed cloud save can turn the editor read-only while a text box is
      // still open. Preserve that text in the explicit local copy, not as a
      // retry against the newer original revision.
      if (pendingText?.composing) throw new Error("TEXT_COMPOSITION_ACTIVE");
      current.content = codec.prepareCopy(current.content, pendingText);
      current.copyRequest = { saveKey: requestKey(), title };
    }
    current.status = "copying"; current.error = null; paint();
    try {
      // Preserve the exact idempotency key and title before submitting. If the
      // response is lost, retry/reload uses the same frozen local document.
      await persist();
      if (epoch !== generation.current) throw new Error("ARTIFACT_CLOSED");
      const copy = await api(codec.copyPath(current.artifactId), {
        method: "POST", body: { saveKey: current.copyRequest.saveKey, content: { ...current.content, title: current.copyRequest.title } },
      });
      invalidateProjectLists(current.userId);
      if (epoch !== generation.current) return copy;
      const remote = await api(codec.readPath(current.artifactId));
      if (epoch !== generation.current) return copy;
      const clean = { ...current, content: remote.content, baseRevision: remote.revision, operations: [], inflight: null, copyRequest: null,
        status: "saved", error: null, past: [], future: [], firstDirtyAt: null };
      // Do not discard the recovery journal until both the copy and the clean
      // local snapshot are safely stored. A failed read/write leaves it retryable.
      await writeArtifactDraft(current.userId, current.artifactId, draftOf(clean), current.draftSessionId);
      if (epoch === generation.current) { model.current = clean; paint(); }
      return copy;
    } catch (error) {
      if (epoch === generation.current) { current.status = "conflict"; current.error = error; paint(); }
      throw error;
    }
  }, [paint, persist, codec]);
  const restoreRevision = useCallback(async revision => {
    const current = model.current, epoch = generation.current;
    if (!current || !codec.restorePath || current.saving || ["conflict", "copying", "restoring"].includes(current.status) || current.operations.length || current.inflight) throw new Error("ARTIFACT_NOT_READY");
    clearTimeout(timer.current); clearTimeout(localTimer.current);
    current.restoreRequest ||= { baseRevision: current.baseRevision, restoreRevision: revision, saveKey: requestKey() };
    current.status = "restoring"; current.error = null; paint();
    try {
      await persist();
      if (epoch !== generation.current) throw new Error("ARTIFACT_CLOSED");
      await api(codec.restorePath(current.artifactId), { method: "POST", body: current.restoreRequest });
      if (epoch !== generation.current) return;
      const remote = await api(codec.readPath(current.artifactId));
      if (epoch !== generation.current) return;
      const clean = { ...current, baseRevision: remote.revision, content: remote.content, restoreRequest: null, status: "saved", error: null, past: [], future: [] };
      await writeArtifactDraft(current.userId, current.artifactId, draftOf(clean), current.draftSessionId);
      if (epoch === generation.current) { model.current = clean; paint(); invalidateProjectLists(current.userId); }
    } catch (error) {
      if (epoch === generation.current && error.code === "ARTIFACT_VERSION_CONFLICT") {
        const clear = { ...current, restoreRequest: null };
        await writeArtifactDraft(current.userId, current.artifactId, draftOf(clear), current.draftSessionId);
        current.restoreRequest = null; setReload(value => value + 1);
      }
      if (epoch === generation.current) { current.status = "error"; current.error = error; paint(); }
      throw error;
    }
  }, [codec, persist, paint]);
  const retry = useCallback(() => {
    if (model.current?.restoreRequest) void restoreRevision(model.current.restoreRequest.restoreRevision).catch(() => {});
    else if (model.current && !["conflict", "copying"].includes(model.current.status)) void flush().catch(() => {});
    else if (!model.current) setReload(value => value + 1);
  }, [flush, restoreRevision]);
  const visible = view.identity === `${userId}:${artifactId}` ? view : { content: null, revision: null, status: "loading", error: null, undo: 0, redo: 0 };
  // Keep clean pages eligible for browser navigation caching. Only warn while
  // a journal exists; pagehide itself is not guaranteed on mobile termination.
  useEffect(() => {
    if (!visible.unsaved) return;
    const beforeUnload = event => { void persist().catch(() => {}); event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [visible.unsaved, persist]);
  const getContent = useCallback(() => model.current?.content, []);
  return { ...visible, ready: Boolean(visible.ready && sessionReady), undoCount: visible.undo, redoCount: visible.redo, change, undo, redo, flush, refreshRemote, persistLocal: persist, retry, saveConflictCopy, restoreRevision, getContent };
}
