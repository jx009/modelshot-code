"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api, requestKey } from "@/lib/client-api";
import { convertNativeOfficeArtifactSchema } from "@/lib/creation/contracts/native-office";
import { creationError } from "./creation-errors";

function createConversionView() {
  const initial = { ready: false, busy: false, request: null, result: null, error: null }, listeners = new Set();
  let value = initial;
  const set = update => { value = { ...value, ...(typeof update === "function" ? update(value) : update) }; listeners.forEach(listener => listener()); };
  return { get: () => value, server: () => initial, set, setBusy: busy => set({ busy }),
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); } };
}
export default function NativeOfficeConversion({ artifactId, userId, enabled, editorRef, onOpenArtifact, onArtifactCreated, zh }) {
  const key = `creation-native-copy:${userId}:${artifactId}`;
  // Browser storage and in-flight requests are an external lifecycle. Activity
  // reconnection reloads that journal instead of retaining an obsolete busy UI.
  const [store] = useState(createConversionView);
  const state = useSyncExternalStore(store.subscribe, store.get, store.server), { busy } = state;
  const setState = store.set, setBusy = store.setBusy;
  const lifetime = useRef(null), working = useRef(null);
  const text = (cn, en) => zh ? cn : en;
  useEffect(() => {
    const life = {}; lifetime.current = life;
    setBusy(false);
    try {
      const raw = sessionStorage.getItem(key), stored = raw ? JSON.parse(raw) : null;
      const request = stored ? convertNativeOfficeArtifactSchema.parse(stored.request) : null;
      const result = stored?.result || null;
      if (result && (result.sourceArtifactId !== artifactId || result.sourceRevision !== request.baseRevision || result.revision !== 1 || typeof result.artifactId !== "string" || !result.artifactId || result.artifactId === artifactId)) throw new Error("NATIVE_OFFICE_DRAFT_INVALID");
      setState({ ready: true, request, result, error: null });
    } catch (error) { setState({ ready: false, request: null, result: null, error }); }
    return () => { if (lifetime.current === life) lifetime.current = null; };
  }, [key, artifactId, setBusy, setState]);
  async function convert() {
    if (working.current === lifetime.current || !state.ready) return;
    const life = lifetime.current;
    working.current = life; setBusy(true);
    let request = state.result ? null : state.request;
    try {
      if (!request) {
        if (!enabled || !editorRef.current) throw new Error("ARTIFACT_NOT_READY");
        const saved = await editorRef.current.flush();
        if (lifetime.current !== life) return;
        request = convertNativeOfficeArtifactSchema.parse({ baseRevision: saved.revision, saveKey: requestKey() });
      }
      // Reserve the fixed intent even on retry: a preceding local-storage
      // failure must never turn into an unjournaled request on the next click.
      sessionStorage.setItem(key, JSON.stringify({ request }));
      setState({ ready: true, request, result: null, error: null });
      const result = await api(`/api/creation/artifacts/${encodeURIComponent(artifactId)}/native/convert`, { method: "POST", body: request, timeoutMs: 30000 });
      if (result.sourceArtifactId !== artifactId || result.sourceRevision !== request.baseRevision || result.revision !== 1 || typeof result.artifactId !== "string" || !result.artifactId || result.artifactId === artifactId) throw new Error("NATIVE_OFFICE_SAVE_RESULT_INVALID");
      // A late response may complete the tab's journal, but never changes a
      // different mounted editor. A remount can replay the same frozen request.
      sessionStorage.setItem(key, JSON.stringify({ request, result }));
      if (lifetime.current === life) { setState({ ready: true, request, result, error: null }); onArtifactCreated?.(result); }
    } catch (error) {
      // These are confirmed rejections before publication, not unknown network
      // outcomes. A corrected source revision can use a new explicit request.
      let reported = error;
      if ([400, 403, 404, 415, 422].includes(error.status)) {
        try { sessionStorage.removeItem(key); request = null; } catch (failure) { reported = failure; }
      }
      if (lifetime.current === life) setState(current => ({ ...current, request, error: reported }));
    } finally { if (working.current === life) working.current = null; if (lifetime.current === life) setBusy(false); }
  }
  if (!enabled && !state.request && !state.error) return null;
  return <div className="cw-native-conversion">
    <span>{state.result ? text(`已根据 V${state.result.sourceRevision} 创建编辑副本，原文件保留。`, `An editing copy of V${state.result.sourceRevision} is ready. The source is retained.`)
      : text("可创建高级编辑副本。原文件继续用于 AI 修改和导出。", "Create a advanced editing copy. The source keeps its AI editing and export workflow.")}</span>
    {(enabled || state.request && !state.result) && <button disabled={busy || !state.ready} onClick={convert}>{text(busy ? "正在转换…" : state.result ? "再创建一份" : state.request ? "恢复上次转换" : "创建高级编辑副本", busy ? "Converting…" : state.result ? "Create another copy" : state.request ? "Recover conversion" : "Create advanced editing copy")}</button>}
    {state.result && onOpenArtifact && <button disabled={busy} onClick={() => onOpenArtifact(state.result.artifactId)}>{text("打开副本", "Open copy")}</button>}
    {state.error && <span role="alert">{creationError(state.error, zh)}</span>}
  </div>;
}
