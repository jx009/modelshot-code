"use client";

import { lazy, Suspense, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useLayoutArtifact } from "./useLayoutArtifact";
import { usePendingTextDraft } from "./usePendingTextDraft";
import { pendingTextOperations } from "@/lib/creation/client/pending-text";
import TextDraftRecovery from "./TextDraftRecovery";
import DraftSessionGate from "./DraftSessionGate";
import HtmlEditor from "./editors/html/HtmlEditor";
import { api, requestKey } from "@/lib/client-api";
import { invalidateProjectLists } from "@/lib/studio/project-list";
import { History, Save, X, RotateCcw, Copy, Download } from "lucide-react";
import "./creation.css";

const LayoutEditor = lazy(() => import("./editors/layout/LayoutEditor"));
const ExportDialog = lazy(() => import("./ExportDialog"));
const labels = {
  loading: ["正在打开作品…", "Opening artwork…"], saved: ["已保存", "Saved"],
  local: ["有未同步修改", "Unsynced changes"], saving: ["正在保存…", "Saving…"],
  conflict: ["云端已有新版本，本地修改已保留", "A newer cloud version exists. Your local changes are retained."],
  copying: ["正在保存本地副本…", "Saving a copy of your edits…"],
  error: ["保存或读取失败", "Save or load failed"],
};
export default function ArtifactEditor({ artifactId, userId, zh = true, onReference, onError, onArtifactCreated, editorRef }) {
  const [generation, setGeneration] = useState(0);
  return <DraftSessionGate key={`${userId}:${artifactId}`} userId={userId} artifactId={artifactId} editorRef={editorRef} zh={zh}>{(draftSessionId, onDrafts) => <EditorSession key={`${userId}:${artifactId}:${generation}`} draftSessionId={draftSessionId} onDrafts={onDrafts} artifactId={artifactId} userId={userId} zh={zh} onReference={onReference} onError={onError} onArtifactCreated={onArtifactCreated} editorRef={editorRef} onReload={() => setGeneration(value => value + 1)} />}</DraftSessionGate>;
}
function EditorSession({ artifactId, userId, draftSessionId, onDrafts, zh, onReference, onError, onArtifactCreated, editorRef, onReload }) {
  const editor = useLayoutArtifact(userId, artifactId, draftSessionId);
  const textDraft = usePendingTextDraft(userId, artifactId, editor.persistLocal, draftSessionId);
  const layout = useRef(null), save = editor.flush;
  const [pendingText, setPendingText] = useState(false);
  const persistText = textDraft.flush, textReady = textDraft.ready, recovery = textDraft.recovery;
  const flush = useCallback(async () => {
    if (!textReady || recovery) throw new Error("TEXT_DRAFT_REVIEW_REQUIRED");
    layout.current?.commitPending();
    const result = await save(); await persistText(); return result;
  }, [save, persistText, textReady, recovery]);
  useImperativeHandle(editorRef, () => ({ flush }), [flush]);
  useEffect(() => {
    if (!pendingText) return;
    const warn = event => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pendingText]);
  const [history, setHistory] = useState(null), [historyError, setHistoryError] = useState(null), [restoring, setRestoring] = useState(false);
  const [copyNotice, setCopyNotice] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const text = (cn, en) => zh ? cn : en;
  const change = editor.change;
  const apply = useCallback(operations => { try { return change(operations); } catch (error) { onError?.(error); return false; } }, [change, onError]);
  async function saveCopy() {
    try {
      if (!textReady) throw new Error("TEXT_DRAFT_REVIEW_REQUIRED");
      const live = layout.current?.getPendingText(), recovered = textDraft.snapshot();
      const pending = live || (recovery && recovered ? { ...recovered, composing: false } : recovered);
      const title = `${editor.content.title.slice(0, 145)}${text("（本地副本）", " (local copy)")}`;
      const copy = await editor.saveConflictCopy(title, pending);
      layout.current?.discardPending(); await textDraft.clear();
      setCopyNotice(true); onArtifactCreated?.(copy);
    } catch (error) { onError?.(error); }
  }
  async function recoverText(draft) {
    try {
      const operations = pendingTextOperations(editor.getContent(), draft);
      if (operations.length && editor.change(operations) === false) throw new Error("TEXT_EDIT_NOT_COMMITTED");
      layout.current?.discardPending();
      await textDraft.clear();
    } catch (error) { onError?.(error); }
  }
  async function discardRecovery() {
    try { layout.current?.discardPending(); await textDraft.clear(); } catch (error) { onError?.(error); }
  }
  async function showHistory() {
    setHistory({ items: [], loading: true }); setHistoryError(null);
    try { setHistory({ ...await api(`/api/creation/artifacts/${encodeURIComponent(artifactId)}/revisions`), loading: false }); }
    catch (error) { setHistoryError(error); setHistory({ items: [], loading: false }); }
  }
  async function moreHistory() {
    if (!history?.nextCursor || history.loading) return;
    setHistory(current => ({ ...current, loading: true }));
    try {
      const result = await api(`/api/creation/artifacts/${encodeURIComponent(artifactId)}/revisions?before=${history.nextCursor}`);
      setHistory(current => ({ ...result, items: [...current.items, ...result.items], loading: false }));
    } catch (error) { setHistoryError(error); setHistory(current => ({ ...current, loading: false })); }
  }
  async function restore(revision) {
    if (restoring) return;
    setRestoring(true);
    try {
      const saved = await flush();
      await api(`/api/creation/artifacts/${encodeURIComponent(artifactId)}/restore`, { method: "POST", body: { baseRevision: saved.revision, restoreRevision: revision, saveKey: requestKey() } });
      invalidateProjectLists(userId);
      onReload();
    } catch (error) { onError?.(error); }
    finally { setRestoring(false); }
  }
  const baseReadOnly = ["loading", "conflict", "copying"].includes(editor.status) || !editor.ready || restoring;
  const readOnly = baseReadOnly || !textReady || Boolean(recovery);
  const ActiveEditor = editor.content?.schemaVersion === 3 ? HtmlEditor : LayoutEditor;
  return <section className="cw-artifact" aria-label={text("作品编辑区", "Artwork editor")}>
    <header className="cw-artifact-bar">
      <div><strong>{editor.content?.title || text("作品", "Artwork")}</strong>{editor.revision && <span>V{editor.revision}</span>}</div>
      <span role="status" className="cw-save-state">{recovery ? text("有待恢复文字", "Text recovery needed") : pendingText ? text("文字尚未保存", "Text not yet saved") : labels[editor.status]?.[zh ? 0 : 1]}</span>
      <button disabled={readOnly} title={text("保存作品", "Save artwork")} onClick={() => void flush().catch(error => onError?.(error))}><Save size={15} /><span>{text("保存", "Save")}</span></button>
      <button title={text("版本历史", "Version history")} onClick={showHistory}><History size={15} /><span>{text("版本", "Versions")}</span></button>
      <button disabled={readOnly} onClick={() => void flush().then(onDrafts).catch(error => onError?.(error))}>{text("本地草稿", "Local drafts")}</button>
      {editor.content && <button title={text("导出作品", "Export artwork")} onClick={() => setExportOpen(true)}><Download size={15} /><span>{text("导出", "Export")}</span></button>}
    </header>
    {editor.error && <div role="alert" className="cw-error">{text("操作未能完成，当前修改会保留。", "The operation could not finish. Your edits are retained.")}{editor.status !== "conflict" && <button onClick={editor.retry}>{text("重试", "Retry")}</button>}</div>}
    {textDraft.error && <div role="alert" className="cw-error">{text("文字草稿暂未能在此设备保存或读取，请重试并保留页面。", "The text draft could not be saved or read on this device. Retry and keep this page open.")}<button onClick={textDraft.retry}>{text("重试本地草稿", "Retry local draft")}</button></div>}
    {recovery && <TextDraftRecovery draft={recovery} content={editor.content} zh={zh} onChange={textDraft.change} onRestore={recoverText} onDiscard={discardRecovery} canRestore={!baseReadOnly} disabled={editor.copyPending || editor.status === "copying"} />}
    {["conflict", "copying"].includes(editor.status) && <div role="alert" className="cw-error"><span>{text("这份作品已在其他位置更新。保存本地副本后，将打开原作品的最新版本。", "This artwork changed elsewhere. Save your edits as a separate copy, then open the latest original.")}</span><button disabled={editor.status === "copying"} onClick={saveCopy}><Copy size={15} />{text("保留修改为副本", "Keep edits as a copy")}</button></div>}
    {copyNotice && <div role="status" className="cw-error">{text("本地修改已另存为项目中的新作品，当前显示原作品的最新版本。", "Your edits are saved as a new artwork in this project. You are viewing the latest original.")}<button aria-label={text("关闭提示", "Dismiss")} onClick={() => setCopyNotice(false)}><X size={14} /></button></div>}
    {editor.content ? <Suspense fallback={<div className="cw-loading" role="status">{text("正在加载编辑器…", "Loading editor…")}</div>}>
      <ActiveEditor controllerRef={layout} getContent={editor.getContent} onPendingChange={setPendingText} onDraftChange={textDraft.change} onFlush={flush} onError={onError} content={editor.content} onOperations={apply} onUndo={() => { try { editor.undo(); } catch (error) { onError?.(error); } }} onRedo={() => { try { editor.redo(); } catch (error) { onError?.(error); } }} canUndo={editor.undoCount > 0} canRedo={editor.redoCount > 0} readOnly={readOnly} zh={zh} onReference={onReference} />
    </Suspense> : <div className="cw-loading" role="status">{labels[editor.status]?.[zh ? 0 : 1]}</div>}
    {exportOpen && <Suspense fallback={<div role="status" className="cw-error">{text("正在打开导出面板…", "Opening export panel…")}</div>}><ExportDialog artifactId={artifactId} userId={userId} kind={editor.content?.kind} sourceSchemaVersion={editor.content?.schemaVersion} onFlush={flush} onClose={() => setExportOpen(false)} zh={zh} /></Suspense>}
    {history && <aside className="cw-version-panel" aria-label={text("版本历史", "Version history")}>
      <header><strong>{text("版本历史", "Version history")}</strong><button aria-label={text("关闭版本历史", "Close history")} onClick={() => setHistory(null)}><X size={16} /></button></header>
      <p>{text("恢复会创建一个新版本，已有历史仍然保留。", "Restore creates a new version and keeps the existing history.")}</p>
      {history.items.map(item => <div className="cw-version-row" key={item.revision}><div><strong>V{item.revision}</strong><time>{new Date(item.createdAt).toLocaleString(zh ? "zh-CN" : "en-US")}</time></div><button disabled={restoring || readOnly || item.revision === editor.revision} onClick={() => restore(item.revision)}><RotateCcw size={14} />{text("恢复", "Restore")}</button></div>)}
      {history.loading && <p role="status">{text("正在读取…", "Loading…")}</p>}
      {historyError && <p role="alert">{text("版本读取失败，请重试。", "Could not load versions. Try again.")}</p>}
      {history.nextCursor && <button disabled={history.loading} onClick={moreHistory}>{text("更早版本", "Earlier versions")}</button>}
    </aside>}
  </section>;
}
