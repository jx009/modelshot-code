"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, requestKey } from "@/lib/client-api";
import { documentContent } from "@/lib/studio/project-title";
import { activeProject, rememberProject, readProjectDraft, writeProjectDraft } from "@/lib/studio/project-storage";

export const emptyProject = () => ({ id: null, version: null, name: "Untitled", nameSource: "fallback", createKey: requestKey(), layers: [], messages: [], jobs: [], appliedJobs: [], plan: null });
const meaningful = draft => draft.layers.length || draft.messages.length || draft.plan;
function projectURL(id, createKey, push = false) {
  const url = new URL(window.location.href);
  url.searchParams.delete("prompt"); url.searchParams.delete("document"); url.searchParams.delete("draft");
  url.searchParams.delete("new");
  url.searchParams.set(id ? "document" : "draft", id || createKey);
  window.history[push ? "pushState" : "replaceState"](null, "", url);
}

export function useStudioProject({ userId, initialDocument, initialPrompt = "", paused, onError }) {
  const [draft, setDraft] = useState(emptyProject), draftRef = useRef(draft);
  const [saveState, setSaveState] = useState("loading"), [ready, setReady] = useState(false);
  const revision = useRef(0), savedRevision = useRef(0), epoch = useRef(0), queue = useRef(Promise.resolve()), localWrite = useRef(Promise.resolve());
  const errorRef = useRef(onError); useEffect(() => { errorRef.current = onError; }, [onError]);
  const persist = useCallback(value => {
    if (!userId) return;
    rememberProject(userId, value);
    localWrite.current = writeProjectDraft(userId, value.id || value.createKey, value);
    localWrite.current.catch(() => errorRef.current("LOCAL_SAVE_FAILED"));
  }, [userId]);
  const update = useCallback(next => {
    const value = typeof next === "function" ? next(draftRef.current) : next;
    if (value === draftRef.current) return value;
    revision.current++;
    const dirty = { ...value, _dirty: true };
    draftRef.current = dirty; setDraft(dirty); setSaveState(state => state === "conflict" ? "conflict" : "local"); persist(dirty);
    return dirty;
  }, [persist]);

  const save = useCallback((copy = false) => {
    const scope = epoch.current;
    const task = async () => {
      if (scope !== epoch.current) throw new Error("SESSION_CLOSED");
      if (!userId) throw new Error("UNAUTHORIZED");
      const d = draftRef.current, rev = revision.current;
      if (!meaningful(d)) return null;
      if (!copy && d.id && savedRevision.current === rev) return { ...d, content: documentContent(d) };
      setSaveState("saving");
      const body = { ...(copy && d.id ? { copyFromId: d.id } : {}), ...(!copy && d.id ? { id: d.id, version: d.version } : { createKey: copy ? requestKey() : d.createKey }), name: d.name, nameSource: d.nameSource || "manual", content: documentContent(d) };
      let saved = await api("/api/studio/documents", { method: "POST", body });
      // A creation retry may return the first accepted snapshot. Preserve edits made since then.
      if (!body.id && saved.replayed) {
        if (saved.version !== 1) {
          if (scope === epoch.current) {
            const conflicted = { ...draftRef.current, id: saved.id, version: 1, _dirty: true };
            draftRef.current = conflicted; setDraft(conflicted); persist(conflicted); projectURL(saved.id);
          }
          throw Object.assign(new Error("DOCUMENT_VERSION_CONFLICT"), { code: "DOCUMENT_VERSION_CONFLICT" });
        }
        saved = await api("/api/studio/documents", { method: "POST", body: { ...body, id: saved.id, version: saved.version } });
      }
      if (scope !== epoch.current) return saved;
      savedRevision.current = rev;
      const current = { ...draftRef.current, ...(revision.current === rev ? { messages: saved.content.messages, name: saved.name } : {}), id: saved.id, version: saved.version, _dirty: revision.current !== rev };
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
  }, [userId, persist]);

  const load = useCallback(async (id, token, push = false, remoteOnly = false) => {
    const scope = ++epoch.current;
    setReady(false); setSaveState("loading");
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
    let value = cached || { ...emptyProject(), ...(initialPrompt ? { composer: { text: initialPrompt } } : {}), ...(token ? { createKey: token } : {}) };
    let conflict = false;
    if (id) {
      try {
        const remote = await api(`/api/studio/documents/${encodeURIComponent(id)}?pagedLayers=1`);
        if (!cached?._dirty && remote.layerCount > remote.content.layers.length) {
          const chunks = await Promise.all(Array.from({ length: Math.ceil(remote.layerCount / 100) - 1 }, (_, index) => api(`/api/studio/documents/${encodeURIComponent(id)}/layers?offset=${(index + 1) * 100}&version=${remote.version}`)));
          remote.content.layers = [...remote.content.layers, ...chunks.flatMap(chunk => chunk.items)];
          if (remote.content.layers.length !== remote.layerCount) throw new Error("DOCUMENT_INCOMPLETE");
        }
        if (cached?._dirty && cached.version !== remote.version) conflict = true;
        if (!cached?._dirty) value = { ...emptyProject(), ...remote.content, id: remote.id, version: remote.version, name: remote.name, nameSource: remote.nameSource, _dirty: false };
      } catch (error) { if (!cached || error.code === "DOCUMENT_NOT_FOUND") throw error; errorRef.current(error); }
    }
    if (scope !== epoch.current) return;
    revision.current = value._dirty ? 1 : 0; savedRevision.current = 0;
    draftRef.current = value; setDraft(value); setReady(true);
    setSaveState(conflict ? "conflict" : value._dirty ? "local" : value.id ? "saved" : "local");
    projectURL(value.id, value.createKey, push);
    persist(value);
    if (conflict) errorRef.current("DOCUMENT_VERSION_CONFLICT");
    return value;
  }, [userId, initialPrompt, persist]);

  useEffect(() => {
    if (!userId) {
      Promise.resolve().then(() => { epoch.current++; const empty = emptyProject(); draftRef.current = empty; setDraft(empty); setReady(false); });
      return;
    }
    const query = new URL(window.location.href).searchParams;
    const current = !initialDocument && !initialPrompt && !query.has("draft") && query.get("new") !== "1" ? activeProject(userId) : null;
    const token = query.get("draft") || current?.createKey || requestKey();
    let active = true;
    Promise.resolve().then(async () => {
      if (!active) return;
      try { return await load(initialDocument || current?.id, token); }
      catch (error) {
        if (current && error.code === "DOCUMENT_NOT_FOUND") return load(null, requestKey());
        throw error;
      }
    }).catch(error => { if (active) { setSaveState("error"); errorRef.current(error); } });
    const pop = () => {
      const url = new URL(window.location.href);
      load(url.searchParams.get("document"), url.searchParams.get("draft") || requestKey()).catch(error => errorRef.current(error));
    };
    window.addEventListener("popstate", pop);
    const invalidate = () => { epoch.current++; };
    return () => { active = false; invalidate(); window.removeEventListener("popstate", pop); };
  }, [userId, initialDocument, initialPrompt, load]);

  useEffect(() => {
    if (!ready || paused || !draft._dirty || saveState === "conflict" || !meaningful(draft)) return;
    const timer = setTimeout(() => save().catch(error => errorRef.current(error)), 800);
    return () => clearTimeout(timer);
    // Saving/error state alone must not start an automatic retry loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, paused, ready, save]);
  useEffect(() => {
    const online = () => { if (draftRef.current._dirty) save().catch(error => errorRef.current(error)); };
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [save]);
  const open = useCallback(async id => {
    if (draftRef.current._dirty) await save();
    return load(id, null, true);
  }, [save, load]);
  const create = useCallback(async () => {
    if (draftRef.current._dirty) await save();
    return load(null, requestKey(), true);
  }, [save, load]);
  const flushLocal = useCallback(() => localWrite.current, []);
  const reloadCloud = useCallback(async () => {
    const value = draftRef.current;
    if (!value.id) return;
    await writeProjectDraft(userId, `recovery:${value.id}:${Date.now()}`, { recovery: value });
    const loaded = await load(value.id, null, false, true);
    if (loaded) persist(loaded);
  }, [userId, load, persist]);
  return { draft, draftRef, update, save, saveState, ready, open, create, flushLocal, reloadCloud };
}
