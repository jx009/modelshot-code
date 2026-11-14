"use client";

import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useImperativeHandle, useRef, useState } from "react";
import { useLayoutArtifact } from "./useLayoutArtifact";
import { useLiveArtifactRevision } from "./useLiveArtifactRevision";
import { usePendingTextDraft } from "./usePendingTextDraft";
import { pendingTextOperations } from "@/lib/creation/client/pending-text";
import TextDraftRecovery from "./TextDraftRecovery";
import DraftSessionGate from "./DraftSessionGate";
import HtmlSlideViewer from "./editors/html/HtmlSlideViewer";
import { artifactResources } from "@/lib/creation/client/artifact-resources";
import { api, requestKey } from "@/lib/client-api";
import { invalidateProjectLists } from "@/lib/studio/project-list";
import { History, Save, X, RotateCcw, Copy, Download, Play, Pencil, Presentation, PanelLeft, StickyNote, Maximize, Minimize, LoaderCircle } from "lucide-react";
import "./creation.css";
import "./workbench.css";

const LayoutEditor = lazy(() => import("./editors/layout/LayoutEditor"));
const HtmlEditor = lazy(() => import("./editors/html/HtmlEditor"));
const HtmlSlidePresentation = lazy(() => import("./editors/html/HtmlSlidePresentation"));
const ExportDialog = lazy(() => import("./ExportDialog"));
const labels = {
  loading: ["正在打开作品…", "Opening artwork…"], saved: ["已保存", "Saved"],
  local: ["有未同步修改", "Unsynced changes"], saving: ["正在保存…", "Saving…"],
  conflict: ["云端已有新版本，本地修改已保留", "A newer cloud version exists. Your local changes are retained."],
  copying: ["正在保存本地副本…", "Saving a copy of your edits…"],
  error: ["保存或读取失败", "Save or load failed"],
};
export default function ArtifactEditor({ artifactId, userId, zh = true, onReference, onError, onArtifactCreated, editorRef, remoteRevision, onResources, onEditingChange }) {
  const [generation, setGeneration] = useState(0);
  return <DraftSessionGate key={`${userId}:${artifactId}`} userId={userId} artifactId={artifactId} editorRef={editorRef} zh={zh}>{(draftSessionId, onDrafts) => <EditorSession key={`${userId}:${artifactId}:${generation}`} draftSessionId={draftSessionId} onDrafts={onDrafts} artifactId={artifactId} userId={userId} zh={zh} onReference={onReference} onError={onError} onArtifactCreated={onArtifactCreated} editorRef={editorRef} remoteRevision={remoteRevision} onResources={onResources} onEditingChange={onEditingChange} onReload={() => setGeneration(value => value + 1)} />}</DraftSessionGate>;
}
function EditorSession({ artifactId, userId, draftSessionId, onDrafts, zh, onReference, onError, onArtifactCreated, editorRef, onReload, remoteRevision, onResources, onEditingChange }) {
  const editor = useLayoutArtifact(userId, artifactId, draftSessionId);
  const textDraft = usePendingTextDraft(userId, artifactId, editor.persistLocal, draftSessionId);
  const layout = useRef(null), save = editor.flush;
  const [pendingText, setPendingText] = useState(false);
  const [editing, setEditing] = useState(false), [selectedPage, setSelectedPage] = useState(null), [presenting, setPresenting] = useState(null), [switching, setSwitching] = useState(false);
  const [thumbnails, setThumbnails] = useState(false), [notes, setNotes] = useState(false), [fullscreen, setFullscreen] = useState(false), [modeNotice, setModeNotice] = useState(null);
  const modeGate = useRef(false);
  useEffect(() => { onEditingChange?.(artifactId, editing); return () => onEditingChange?.(artifactId, false); }, [artifactId, editing, onEditingChange]);
  const persistText = textDraft.flush, textReady = textDraft.ready, recovery = textDraft.recovery;
  const flush = useCallback(async () => {
    if (!textReady || recovery) throw new Error("TEXT_DRAFT_REVIEW_REQUIRED");
    layout.current?.commitPending();
    const result = await save(); await persistText(); return result;
  }, [save, persistText, textReady, recovery]);
  useImperativeHandle(editorRef, () => ({ flush }), [flush]);
  useEffect(() => {
    if (!pendingText && !recovery) return;
    const warn = event => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pendingText, recovery]);
  const [history, setHistory] = useState(null), [historyError, setHistoryError] = useState(null), [restoring, setRestoring] = useState(false);
  const [copyNotice, setCopyNotice] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const root = useRef(null), interacting = useRef(false), nativeDrag = useRef(false), syncState = useRef(null);
  useLayoutEffect(() => { syncState.current = { textReady, recovery, restoring, exportOpen, history, presenting, switching, editing }; });
  useEffect(() => {
    const release = () => { interacting.current = false; };
    const releaseDrag = () => { release(); nativeDrag.current = false; };
    window.addEventListener("pointerup", release); window.addEventListener("pointercancel", release); window.addEventListener("blur", release);
    window.addEventListener("dragend", releaseDrag); window.addEventListener("drop", releaseDrag); window.addEventListener("blur", releaseDrag);
    return () => { window.removeEventListener("pointerup", release); window.removeEventListener("pointercancel", release); window.removeEventListener("blur", release); window.removeEventListener("dragend", releaseDrag); window.removeEventListener("drop", releaseDrag); window.removeEventListener("blur", releaseDrag); };
  }, []);
  const snapshotText = textDraft.snapshot;
  const canApplyRemote = useCallback(() => {
    const state = syncState.current, focused = document.activeElement;
    return Boolean(document.visibilityState !== "hidden" && state?.textReady && !state.recovery && !state.restoring && !state.exportOpen && !state.history && !state.presenting && !state.switching && !state.editing
      && !interacting.current && !nativeDrag.current && !snapshotText() && layout.current?.canRefreshRemote?.()
      && !(root.current?.contains(focused) && focused?.matches("input, textarea, select, [contenteditable]")));
  }, [snapshotText]);
  useLiveArtifactRevision({ target: remoteRevision, revision: editor.revision, ready: editor.ready && textReady && !recovery, status: editor.status, refreshRemote: editor.refreshRemote, canApply: canApplyRemote });
  const text = (cn, en) => zh ? cn : en;
  useEffect(() => {
    if (!editor.ready || !editor.content || !onResources) return;
    const timer = setTimeout(() => onResources(artifactResources(artifactId, editor.content)), 120);
    return () => clearTimeout(timer);
  }, [artifactId, editor.content, editor.ready, onResources]);
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
  const htmlSlides = editor.content?.kind === "slides" && editor.content?.schemaVersion === 3;
  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement === root.current);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  async function toggleFullscreen() {
    try { if (document.fullscreenElement === root.current) await document.exitFullscreen(); else await root.current?.requestFullscreen(); }
    catch (error) { onError?.(error); }
  }
  async function switchMode(next, pageId) {
    if (modeGate.current) return;
    modeGate.current = true; setSwitching(true);
    try {
      if (editing) {
        // Exiting the editor must not wait for the US save request. Commit into
        // the mounted journal first, retain its local recovery record, then sync.
        try { layout.current?.commitPending(); }
        catch (error) {
          // Keep invalid/incomplete source or text recoverable without forcing
          // the editor to stay open. Recovery UI remains in the parent session.
          textDraft.reviewPending();
          setModeNotice(text("已返回浏览；未提交的文字已保留，请在恢复提示中继续处理。", "Back in browse mode. Uncommitted text is retained in the recovery panel."));
          onError?.(error);
        }
        setEditing(false); setThumbnails(false); setPendingText(false);
        void editor.persistLocal().then(() => persistText()).catch(error => { setModeNotice(text("已返回浏览，修改仍在当前页面；本地保存失败，请保留页面并重试保存。", "Back in browse mode. Edits remain in this page; local saving failed. Keep the page open and retry saving.")); onError?.(error); });
        void save().catch(error => { setModeNotice(text("已返回浏览，修改尚未同步到云端，可点击重试保存。", "Back in browse mode. Edits have not synced; retry saving.")); onError?.(error); });
      }
      if (pageId) setSelectedPage(pageId);
      if (next) { setEditing(true); setThumbnails(true); setModeNotice(null); }
    } catch (error) { onError?.(error); }
    finally { modeGate.current = false; setSwitching(false); }
  }
  async function present() {
    if (modeGate.current) return;
    modeGate.current = true; setSwitching(true);
    try { const saved = await flush(); setPresenting(saved.content); }
    catch (error) { onError?.(error); }
    finally { modeGate.current = false; setSwitching(false); }
  }
  const baseReadOnly = ["loading", "conflict", "copying"].includes(editor.status) || !editor.ready || restoring;
  const readOnly = baseReadOnly || !textReady || Boolean(recovery) || switching;
  const ActiveEditor = editor.content?.schemaVersion === 3 ? HtmlEditor : LayoutEditor;
  return <section ref={root} onPointerDownCapture={() => { interacting.current = true; }} onDragStartCapture={() => { nativeDrag.current = true; }} onDragEndCapture={() => { interacting.current = false; nativeDrag.current = false; }} onDropCapture={() => { interacting.current = false; nativeDrag.current = false; }} className="cw-artifact" aria-label={text("作品编辑区", "Artwork editor")}>
    <header className="cw-artifact-bar" data-editing={htmlSlides && editing}>
      <div>{htmlSlides && <Presentation size={17} className="cw-ppt-icon" />}<strong title={editor.content?.title}>{htmlSlides && <span className="cw-view-label">{text(editing ? "正在编辑 " : "正在浏览 ", editing ? "Editing " : "Viewing ")}</span>}{editor.content?.title || text("作品", "Artwork")}</strong>{editor.revision && <span>V{editor.revision}</span>}</div>
      <span role="status" className="cw-save-state">{recovery ? text("有待恢复文字", "Text recovery needed") : pendingText ? text("文字尚未保存", "Text not yet saved") : editor.status === "saved" && remoteRevision > editor.revision ? text("有新版本，空闲时自动同步", "New version; syncing when idle") : labels[editor.status]?.[zh ? 0 : 1]}</span>
      {htmlSlides && !editing && <><button className="cw-mode-icon" aria-label={text("页面缩略图", "Slide thumbnails")} title={text("页面缩略图", "Slide thumbnails")} aria-pressed={thumbnails} onClick={() => setThumbnails(value => !value)}><PanelLeft size={15} /></button><button className="cw-mode-icon" aria-label={text("页面备注", "Speaker notes")} title={text("页面备注", "Speaker notes")} aria-pressed={notes} onClick={() => setNotes(value => !value)}><StickyNote size={15} /></button><span className="cw-artifact-toolbar-spacer" /><button disabled={readOnly} aria-label={text("演示", "Present")} onPointerEnter={() => { void import("./editors/html/HtmlSlidePresentation").catch(() => {}); }} onClick={present}><Play size={15} /><span>{text("演示", "Present")}</span></button><button disabled={readOnly} aria-label={text("编辑", "Edit")} onPointerEnter={() => { void import("./editors/html/HtmlEditor").catch(() => {}); }} onClick={() => void switchMode(true)}><Pencil size={15} /><span>{text("编辑", "Edit")}</span></button></>}
      {htmlSlides && editing && <><span className="cw-artifact-toolbar-spacer" /><button className="cw-exit-editing" disabled={switching} onClick={() => void switchMode(false)}>{switching && <LoaderCircle size={14} className="animate-spin" />}{text("退出编辑", "Exit editing")}</button><button className="cw-save-editing" disabled={readOnly || editor.status === "saving"} onClick={() => void flush().then(() => setModeNotice(null)).catch(error => { setModeNotice(text("保存失败，修改已保留，请重试。", "Save failed. Edits are retained; retry.")); onError?.(error); })}>{editor.status === "saving" && <LoaderCircle size={14} className="animate-spin" />}{text(editor.status === "saving" ? "正在保存" : "保存编辑", editor.status === "saving" ? "Saving" : "Save changes")}</button></>}
      {!htmlSlides && <button disabled={readOnly} title={text("保存作品", "Save artwork")} onClick={() => void flush().catch(error => onError?.(error))}><Save size={15} /><span>{text("保存", "Save")}</span></button>}
      {(!htmlSlides || !editing) && <button aria-label={text("版本历史", "Version history")} title={text("版本历史", "Version history")} onClick={showHistory}><History size={15} />{!htmlSlides && <span>{text("版本", "Versions")}</span>}</button>}
      {!htmlSlides && <button disabled={readOnly} onClick={() => void flush().then(onDrafts).catch(error => onError?.(error))}>{text("本地草稿", "Local drafts")}</button>}
      {editor.content && (!htmlSlides || !editing) && <button aria-label={text("导出作品", "Export artwork")} title={text("导出作品", "Export artwork")} onClick={() => setExportOpen(true)}><Download size={15} />{!htmlSlides && <span>{text("导出", "Export")}</span>}</button>}
      {htmlSlides && <button aria-label={text(fullscreen ? "退出全屏" : "全屏查看", fullscreen ? "Exit fullscreen" : "Fullscreen")} title={text(fullscreen ? "退出全屏" : "全屏查看", fullscreen ? "Exit fullscreen" : "Fullscreen")} onClick={toggleFullscreen}>{fullscreen ? <Minimize size={15} /> : <Maximize size={15} />}</button>}
    </header>
    {modeNotice && <div role="status" className="cw-error"><span>{modeNotice}</span><button disabled={editor.status === "saving"} onClick={() => void flush().then(() => setModeNotice(null)).catch(error => onError?.(error))}>{text("重试保存", "Retry save")}</button><button aria-label={text("关闭提示", "Dismiss")} onClick={() => setModeNotice(null)}><X size={13} /></button></div>}
    {editor.error && <div role="alert" className="cw-error">{text("操作未能完成，当前修改会保留。", "The operation could not finish. Your edits are retained.")}{editor.status !== "conflict" && <button onClick={editor.retry}>{text("重试", "Retry")}</button>}</div>}
    {textDraft.error && <div role="alert" className="cw-error">{text("文字草稿暂未能在此设备保存或读取，请重试并保留页面。", "The text draft could not be saved or read on this device. Retry and keep this page open.")}<button onClick={textDraft.retry}>{text("重试本地草稿", "Retry local draft")}</button></div>}
    {recovery && <TextDraftRecovery draft={recovery} content={editor.content} zh={zh} onChange={textDraft.change} onRestore={recoverText} onDiscard={discardRecovery} canRestore={!baseReadOnly} disabled={editor.copyPending || editor.status === "copying"} />}
    {["conflict", "copying"].includes(editor.status) && <div role="alert" className="cw-error"><span>{text("这份作品已在其他位置更新。保存本地副本后，将打开原作品的最新版本。", "This artwork changed elsewhere. Save your edits as a separate copy, then open the latest original.")}</span><button disabled={editor.status === "copying"} onClick={saveCopy}><Copy size={15} />{text("保留修改为副本", "Keep edits as a copy")}</button></div>}
    {copyNotice && <div role="status" className="cw-error">{text("本地修改已另存为项目中的新作品，当前显示原作品的最新版本。", "Your edits are saved as a new artwork in this project. You are viewing the latest original.")}<button aria-label={text("关闭提示", "Dismiss")} onClick={() => setCopyNotice(false)}><X size={14} /></button></div>}
    {editor.content ? <Suspense fallback={<div className="cw-loading" role="status">{text("正在加载编辑器…", "Loading editor…")}</div>}>
      {htmlSlides ? <HtmlSlideViewer controllerRef={layout} content={editor.content} onOperations={apply} onError={onError} onEdit={id => void switchMode(true, id)} onPage={setSelectedPage} initialPageId={selectedPage} readOnly={readOnly} zh={zh} editing={editing} thumbnails={thumbnails} onThumbnails={setThumbnails} notes={notes} editorProps={{ getContent: editor.getContent, onPendingChange: setPendingText, onDraftChange: textDraft.change, onUndo: editor.undo, onRedo: editor.redo, canUndo: editor.undoCount > 0, canRedo: editor.redoCount > 0, onReference: value => { void switchMode(false).then(() => onReference?.(value)).catch(error => onError?.(error)); } }} /> : <ActiveEditor initialPageId={selectedPage} onPageChange={setSelectedPage} controllerRef={layout} getContent={editor.getContent} onPendingChange={setPendingText} onDraftChange={textDraft.change} onFlush={flush} onError={onError} content={editor.content} onOperations={apply} onUndo={() => { try { editor.undo(); } catch (error) { onError?.(error); } }} onRedo={() => { try { editor.redo(); } catch (error) { onError?.(error); } }} canUndo={editor.undoCount > 0} canRedo={editor.redoCount > 0} readOnly={readOnly} zh={zh} onReference={onReference} />}
    </Suspense> : <div className="cw-loading" role="status">{labels[editor.status]?.[zh ? 0 : 1]}</div>}
    {exportOpen && <Suspense fallback={<div role="status" className="cw-error">{text("正在打开导出面板…", "Opening export panel…")}</div>}><ExportDialog artifactId={artifactId} userId={userId} kind={editor.content?.kind} onFlush={flush} onClose={() => setExportOpen(false)} zh={zh} /></Suspense>}
    {presenting && <Suspense fallback={<div role="status" className="cw-error">{text("正在打开演示…", "Opening presentation…")}</div>}><HtmlSlidePresentation content={presenting} startPageId={selectedPage} zh={zh} onClose={() => setPresenting(null)} /></Suspense>}
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
