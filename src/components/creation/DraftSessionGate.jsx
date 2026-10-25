"use client";

import { useEffect, useImperativeHandle, useState } from "react";
import { listArtifactDraftSessions, copyArtifactDraftSession, removeArtifactDraftSession } from "@/lib/creation/client/drafts";
import { creationDraftSession, rememberedDraftSession, rememberDraftSession, newDraftBranch } from "@/lib/creation/client/draft-session";
import { creationError } from "./creation-errors";

function PendingEditorHandle({ editorRef }) {
  useImperativeHandle(editorRef, () => ({ flush: async () => { throw new Error("LOCAL_DRAFT_SELECTION_REQUIRED"); } }), []);
  return null;
}
export default function DraftSessionGate({ userId, artifactId, editorRef, zh, children }) {
  const [state, setState] = useState({ loading: true, sessionId: null, items: [], ready: false, error: null });
  const [attempt, setAttempt] = useState(0), [forcePicker, setForcePicker] = useState(false), [busy, setBusy] = useState(false), [deleting, setDeleting] = useState(null);
  const text = (cn, en) => zh ? cn : en;
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const remembered = rememberedDraftSession(userId, artifactId), sessionId = remembered || creationDraftSession();
        // An already chosen session still reads its own operation/text journals
        // in the editor. Listing every other branch need not delay reopening it.
        if (remembered && !forcePicker) { if (alive) setState({ loading: false, sessionId, items: [], ready: true, error: null }); return; }
        const result = await listArtifactDraftSessions(userId, artifactId, sessionId);
        if (!alive) return;
        const ready = !forcePicker && (result.own || remembered || result.items.length === 0);
        if (ready) rememberDraftSession(userId, artifactId, sessionId);
        setState({ loading: false, sessionId, items: result.items, ready, error: null });
      } catch (error) {
        if (alive) { error.code ||= "LOCAL_DRAFT_UNAVAILABLE"; setState({ loading: false, sessionId: creationDraftSession(), items: [], ready: false, error }); }
      }
    }
    void load();
    return () => { alive = false; };
  }, [userId, artifactId, attempt, forcePicker]);
  function enter(sessionId = state.sessionId) {
    rememberDraftSession(userId, artifactId, sessionId); setForcePicker(false); setState(value => ({ ...value, sessionId, ready: true, error: null }));
  }
  async function restore(item) {
    if (busy) return;
    setBusy(true);
    try { const destination = newDraftBranch(); await copyArtifactDraftSession(userId, artifactId, item, destination); enter(destination); }
    catch (error) { setState(value => ({ ...value, error })); }
    finally { setBusy(false); }
  }
  async function remove(item) {
    if (busy) return;
    setBusy(true);
    try {
      await removeArtifactDraftSession(userId, artifactId, item);
      setDeleting(null); setAttempt(value => value + 1);
    } catch (error) { setState(value => ({ ...value, error })); }
    finally { setBusy(false); }
  }
  const openPicker = () => { setForcePicker(true); setState(value => ({ ...value, ready: false, loading: true })); setAttempt(value => value + 1); };
  if (state.ready) return children(state.sessionId, openPicker);
  if (state.loading) return <div className="cw-loading" role="status"><PendingEditorHandle editorRef={editorRef} />{text("正在读取作品与本地修改…", "Opening artwork and local edits…")}</div>;
  return <section className="cw-local-drafts" aria-label={text("本地草稿恢复", "Local draft recovery")}>
    <PendingEditorHandle editorRef={editorRef} />
    <h3>{text("这台设备上的未同步草稿", "Unsynced drafts on this device")}</h3>
    <p>{text("每个标签页独立保留修改。恢复会复制所选草稿到当前页面，不会改变其他标签页。", "Each browser session keeps its own edits. Recovery copies the selected draft here without changing other tabs.")}</p>
    {state.loading && <p role="status">{text("正在读取草稿…", "Loading drafts…")}</p>}
    {state.items.map((item, index) => <article key={item.sessionId}>
      <div><strong>{text(`草稿 ${index + 1}`, `Draft ${index + 1}`)}</strong><time>{new Date(item.updatedAt).toLocaleString(zh ? "zh-CN" : "en-US")}</time>{item.hasText && <small>{text("包含未提交文字", "Includes unfinished text")}</small>}</div>
      <button disabled={busy || state.loading} onClick={() => void restore(item)}>{text("恢复此草稿", "Recover draft")}</button>
      {deleting === item.sessionId ? <><span>{text("仅移除这份本地草稿，云端作品不受影响。", "Remove this local draft only. The cloud artwork is unchanged.")}</span><button disabled={busy} onClick={() => void remove(item)}>{text("确认移除", "Confirm removal")}</button><button disabled={busy} onClick={() => setDeleting(null)}>{text("取消", "Cancel")}</button></> : <button disabled={busy || state.loading} onClick={() => setDeleting(item.sessionId)}>{text("移除", "Remove")}</button>}
    </article>)}
    {!state.loading && !state.items.length && !state.error && <p>{text("没有其他未同步草稿。", "There are no other unsynced drafts.")}</p>}
    {state.error && <p role="alert">{creationError(state.error, zh)}</p>}
    <footer><button disabled={busy || state.loading} onClick={() => { setDeleting(null); setAttempt(value => value + 1); }}>{text("刷新草稿列表", "Refresh drafts")}</button>
      <button disabled={busy || state.loading || !state.sessionId} onClick={() => enter()}>{text("打开当前版本", "Open current version")}</button></footer>
  </section>;
}
