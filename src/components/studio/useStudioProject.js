"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, requestKey } from "@/lib/client-api";
import { documentContent } from "@/lib/studio/project-title";
import { submitDocument, transientSaveError } from "@/lib/studio/save-document";
import { activeProject, rememberProject, readProjectDraft, writeProjectDraft } from "@/lib/studio/project-storage";
import { invalidateProjectLists } from "@/lib/studio/project-list";
import { mapWithConcurrency } from "@/lib/map-with-concurrency";

export const emptyProject = () => ({ id: null, version: null, name: "Untitled", nameSource: "fallback", createKey: requestKey(), layers: [], messages: [], jobs: [], appliedJobs: [], plan: null });
const meaningful = draft => draft.id || draft.layers.length || draft.messages.length || draft.plan;
function projectURL(id, createKey, push = false) {
  const url = new URL(window.location.href);
  if (!/^\/(?:zh\/|en\/)?studio-v2\/?$/.test(url.pathname)) return;
  url.searchParams.delete("prompt"); url.searchParams.delete("document"); url.searchParams.delete("draft");
  url.searchParams.delete("new");
  url.searchParams.set(id ? "document" : "draft", id || createKey);
  window.history[push ? "pushState" : "replaceState"](null, "", url);
}

export function useStudioProject({ userId, sessionLoading = false, initialDocument, initialPrompt = "", initialSize = "1024x1024", initialCount = 1, initialFixed = "", paused, onError }) {
  // A background session refresh must not reload an already authenticated canvas.
  const awaitingSession = !userId && sessionLoading;
  const [draft, setDraft] = useState(emptyProject), draftRef = useRef(draft);
  const [saveState, setSaveState] = useState("loading"), [ready, setReady] = useState(false);
  const [switching, setSwitching] = useState(false), switchOperation = useRef(null);
  const loadController = useRef(null), loadTarget = useRef(null), editingReady = useRef(false);
  const revision = useRef(0), savedRevision = useRef(0), epoch = useRef(0), queue = useRef(Promise.resolve()), localWrite = useRef(Promise.resolve()), localWriteTimer = useRef(null), pendingLocalWrite = useRef(null);
  const errorRef = useRef(onError); useEffect(() => { errorRef.current = onError; }, [onError]);
  const flushLocal = useCallback(() => {
    if (localWriteTimer.current) {
      clearTimeout(localWriteTimer.current);
      localWriteTimer.current = null;
    }
    const pending = pendingLocalWrite.current;
    if (!pending) return localWrite.current;
    pendingLocalWrite.current = null;
    localWrite.current = localWrite.current.catch(() => {}).then(() => writeProjectDraft(pending.userId, pending.key, pending.value));
    localWrite.current.catch(() => errorRef.current("LOCAL_SAVE_FAILED"));
    return localWrite.current;
  }, []);
  const persist = useCallback(value => {
    if (!userId) return;
    rememberProject(userId, value);
    pendingLocalWrite.current = { userId, key: value.id || value.createKey, value };
    if (!localWriteTimer.current) localWriteTimer.current = setTimeout(() => { localWriteTimer.current = null; flushLocal(); }, 180);
  }, [flushLocal, userId]);
  const update = useCallback(next => {
    if (!editingReady.current || switchOperation.current) return draftRef.current;
    const value = typeof next === "function" ? next(draftRef.current) : next;
    if (value === draftRef.current) return value;
    revision.current++;
    const dirty = { ...value, _dirty: true };
    draftRef.current = dirty; setDraft(dirty); setSaveState(state => state === "conflict" ? "conflict" : "local"); persist(dirty);
    return dirty;
  }, [persist]);

  const save = useCallback((copy = false) => {
    if (!editingReady.current) return Promise.reject(new Error("DOCUMENT_LOADING"));
    const scope = epoch.current;
    const task = async () => {
      if (scope !== epoch.current) throw new Error("SESSION_CLOSED");
      if (!userId) throw new Error("UNAUTHORIZED");
      await flushLocal().catch(() => {});
      if (scope !== epoch.current) throw new Error("SESSION_CLOSED");
      const send = async body => {
        if (scope !== epoch.current) throw new Error("SESSION_CLOSED");
        draftRef.current = { ...draftRef.current, _pendingSave: body };
        persist(draftRef.current);
        try {
          const result = await submitDocument(body, { isCurrent: () => scope === epoch.current, onRetry: () => setSaveState("retrying") });
          invalidateProjectLists(userId);
          return result;
        } catch (error) {
          if (scope === epoch.current && !transientSaveError(error)) {
            draftRef.current = { ...draftRef.current, _pendingSave: undefined };
            persist(draftRef.current);
          }
          throw error;
        }
      };
      // Resolve an uncertain write before sending newer edits with another version.
      if (!copy && draftRef.current._pendingSave) {
        const pending = draftRef.current._pendingSave;
        const recovered = await send(pending);
        if (scope !== epoch.current) throw new Error("SESSION_CLOSED");
        if (recovered.replayed && !recovered.acknowledged) throw Object.assign(new Error("DOCUMENT_VERSION_CONFLICT"), { code: "DOCUMENT_VERSION_CONFLICT" });
        draftRef.current = { ...draftRef.current, id: recovered.id, version: recovered.version, _pendingSave: undefined };
        persist(draftRef.current);
      }
      const d = draftRef.current, rev = revision.current;
      if (!meaningful(d)) return null;
      if (!copy && d.id && savedRevision.current === rev) return { ...d, content: documentContent(d) };
      setSaveState("saving");
      const body = { saveKey: requestKey(), ...(copy && d.id ? { copyFromId: d.id } : {}), ...(!copy && d.id ? { id: d.id, version: d.version } : { createKey: copy ? requestKey() : d.createKey }), name: d.name, nameSource: d.nameSource || "manual", content: documentContent(d) };
      let saved = await send(body);
      // A creation retry may return the first accepted snapshot. Preserve edits made since then.
      if (!body.id && saved.replayed && !saved.acknowledged) {
        if (saved.version !== 1) {
          if (scope === epoch.current) {
            const conflicted = { ...draftRef.current, id: saved.id, version: 1, _dirty: true };
            draftRef.current = conflicted; setDraft(conflicted); persist(conflicted); projectURL(saved.id);
          }
          throw Object.assign(new Error("DOCUMENT_VERSION_CONFLICT"), { code: "DOCUMENT_VERSION_CONFLICT" });
        }
        saved = await send({ ...body, saveKey: requestKey(), id: saved.id, version: saved.version });
      }
      if (scope !== epoch.current) return saved;
      savedRevision.current = rev;
      const current = { ...draftRef.current, ...(revision.current === rev ? { messages: saved.content.messages, name: saved.name } : {}), id: saved.id, version: saved.version, _pendingSave: undefined, _dirty: revision.current !== rev };
      draftRef.current = current; setDraft(current); persist(current);
      setSaveState(current._dirty ? "local" : "saved"); projectURL(saved.id);
      return saved;
    };
    const pending = queue.current.catch(() => {}).then(task).catch(error => {
      if (scope === epoch.current) setSaveState(error.code === "DOCUMENT_VERSION_CONFLICT" ? "conflict" : "error");
      throw error;
    });
    queue.current = pending;
    return pending;
  }, [userId, persist, flushLocal]);

  const load = useCallback(async (id, token, push = false, remoteOnly = false) => {
    const scope = ++epoch.current;
    editingReady.current = false;
    loadTarget.current = { id, token, push, remoteOnly };
    loadController.current?.abort();
    setReady(false); setSaveState("loading");
    await flushLocal().catch(() => {});
    if (scope !== epoch.current) return;
    let cached = remoteOnly ? null : await readProjectDraft(userId, id || token).catch(() => null);
    if (!cached && !remoteOnly) {
      try {
        const legacy = JSON.parse(localStorage.getItem(`modelshot-studio-v1:${userId}`));
        if (legacy?.layers && legacy?.messages && (id ? legacy.id === id : !legacy.id)) {
          cached = { ...emptyProject(), ...legacy, _dirty: true };
          await writeProjectDraft(userId, id || token, cached);
          localStorage.removeItem(`modelshot-studio-v1:${userId}`);
        }
      } catch { /* The cloud copy remains the fallback for invalid legacy drafts. */ }
    }
    let value = cached || { ...emptyProject(), ...(initialPrompt ? { composer: { text: initialPrompt, size: initialSize, outputCount: initialCount, fixedPrompt: initialFixed } } : {}), ...(token ? { createKey: token } : {}) };
    if (scope !== epoch.current) return;
    // Paint the user's local copy while cloud validation is pending. Editing and
    // saving stay gated by ready until versions and pending writes are reconciled.
    draftRef.current = value; setDraft(value);
    let conflict = false;
    if (id) {
      const controller = new AbortController();
      loadController.current = controller;
      const timeout = setTimeout(() => controller.abort(new Error("DOCUMENT_LOAD_TIMEOUT")), 15000);
      try {
        const remote = await api(`/api/studio/documents/${encodeURIComponent(id)}?pagedLayers=1`, { signal: controller.signal });
        const pending = cached?._pendingSave;
        if (pending?.saveKey && remote.lastSaveKey === pending.saveKey && remote.version === (pending.id ? pending.version + 1 : 1)) {
          cached = { ...cached, version: remote.version, _pendingSave: undefined };
          value = cached;
        }
        if (!cached?._dirty && remote.layerCount > remote.content.layers.length) {
          const offsets = Array.from({ length: Math.ceil(remote.layerCount / 100) - 1 }, (_, index) => (index + 1) * 100);
          const chunks = await mapWithConcurrency(offsets, 2, async offset => {
            controller.signal.throwIfAborted();
            try {
              return await api(`/api/studio/documents/${encodeURIComponent(id)}/layers?offset=${offset}&version=${remote.version}`, { signal: controller.signal });
            } catch (error) { controller.abort(error); throw error; }
          });
          const failed = chunks.find(chunk => chunk.status === "rejected");
          if (failed) throw failed.reason;
          remote.content.layers = [...remote.content.layers, ...chunks.flatMap(chunk => chunk.value.items)];
          if (remote.content.layers.length !== remote.layerCount) throw new Error("DOCUMENT_INCOMPLETE");
        }
        if (cached?._dirty && cached.version !== remote.version) conflict = true;
        if (!cached?._dirty) value = { ...emptyProject(), ...remote.content, id: remote.id, version: remote.version, name: remote.name, nameSource: remote.nameSource, _dirty: false };
      } catch (error) {
        if (scope !== epoch.current) return;
        if (!cached || ["DOCUMENT_NOT_FOUND", "UNAUTHORIZED", "FORBIDDEN"].includes(error.code)) { setSaveState("load-error"); throw error; }
        errorRef.current(error);
      } finally { clearTimeout(timeout); }
    }
    if (scope !== epoch.current) return;
    revision.current = value._dirty ? 1 : 0; savedRevision.current = 0;
    editingReady.current = true;
    draftRef.current = value; setDraft(value); setReady(true);
    setSaveState(conflict ? "conflict" : value._dirty ? "local" : value.id ? "saved" : "local");
    projectURL(value.id, value.createKey, push);
    persist(value);
    if (conflict) errorRef.current("DOCUMENT_VERSION_CONFLICT");
    return value;
  }, [userId, initialPrompt, initialSize, initialCount, initialFixed, persist, flushLocal]);

  useEffect(() => {
    switchOperation.current = null;
    if (!userId) {
      let active = true;
      Promise.resolve().then(() => {
        if (!active) return;
        setSwitching(false);
        epoch.current++;
        const empty = { ...emptyProject(), composer: { text: initialPrompt, size: initialSize, outputCount: initialCount, fixedPrompt: initialFixed } };
        editingReady.current = !awaitingSession;
        draftRef.current = empty; setDraft(empty); setReady(!awaitingSession); setSaveState(awaitingSession ? "loading" : "local");
      });
      return () => { active = false; };
    }
    const query = new URL(window.location.href).searchParams;
    const current = !initialDocument && !initialPrompt && !query.has("draft") && query.get("new") !== "1" ? activeProject(userId) : null;
    const token = query.get("draft") || current?.createKey || requestKey();
    let active = true;
    Promise.resolve().then(async () => {
      if (!active) return;
      setSwitching(false);
      try { return await load(initialDocument || current?.id, token); }
      catch (error) {
        if (current && error.code === "DOCUMENT_NOT_FOUND") return load(null, requestKey());
        throw error;
      }
    }).catch(error => { if (active) { setSaveState("load-error"); errorRef.current(error); } });
    const pop = () => {
      const url = new URL(window.location.href);
      if (!/^\/(?:zh\/|en\/)?studio-v2\/?$/.test(url.pathname)) return;
      load(url.searchParams.get("document"), url.searchParams.get("draft") || requestKey()).catch(error => errorRef.current(error));
    };
    window.addEventListener("popstate", pop);
    const invalidate = () => { epoch.current++; switchOperation.current = null; editingReady.current = false; loadController.current?.abort(); };
    return () => { active = false; invalidate(); window.removeEventListener("popstate", pop); };
  }, [userId, awaitingSession, initialDocument, initialPrompt, initialSize, initialCount, initialFixed, load]);

  useEffect(() => {
    if (!userId || !ready || paused || !draft._dirty || saveState === "conflict" || !meaningful(draft)) return;
    const timer = setTimeout(() => save().catch(error => errorRef.current(error)), 800);
    return () => clearTimeout(timer);
    // Saving/error state alone must not start an automatic retry loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, paused, ready, save, userId]);
  useEffect(() => {
    const online = () => { if (draftRef.current._dirty) save().catch(error => errorRef.current(error)); };
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [save]);
  const switchProject = useCallback(async (id, token) => {
    if (switchOperation.current || !editingReady.current) throw new Error("DOCUMENT_LOADING");
    const operation = {};
    switchOperation.current = operation;
    setSwitching(true);
    try {
      if (draftRef.current._dirty || draftRef.current._pendingSave) await save();
      if (switchOperation.current !== operation) throw new Error("SESSION_CLOSED");
      const loaded = await load(id, token, true);
      if (switchOperation.current !== operation || !loaded) throw new Error("SESSION_CLOSED");
      return loaded;
    } finally {
      if (switchOperation.current === operation) { switchOperation.current = null; setSwitching(false); }
    }
  }, [save, load]);
  const open = useCallback(id => switchProject(id, null), [switchProject]);
  const create = useCallback(() => switchProject(null, requestKey()), [switchProject]);
  useEffect(() => {
    const flush = () => { void flushLocal(); };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      void flushLocal();
    };
  }, [flushLocal]);
  const reloadCloud = useCallback(async () => {
    const value = draftRef.current;
    if (!value.id) return;
    await writeProjectDraft(userId, `recovery:${value.id}:${Date.now()}`, { recovery: value });
    const loaded = await load(value.id, null, false, true);
    if (loaded) persist(loaded);
  }, [userId, load, persist]);
  const retryLoad = useCallback(() => {
    const target = loadTarget.current;
    if (target) return load(target.id, target.token, target.push, target.remoteOnly).catch(error => errorRef.current(error));
  }, [load]);
  return { draft, draftRef, update, save, saveState, ready: ready && !switching, switching, open, create, flushLocal, reloadCloud, retryLoad };
}
