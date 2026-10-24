"use client";

import { lazy, Suspense, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Code, Download, Eye, History, Monitor, Smartphone, MousePointer2, Save, Undo2, Redo2, X, FilePlus2, Copy, Trash2, House, Pencil, ImagePlus } from "lucide-react";
import { api, requestKey } from "@/lib/client-api";
import { pendingWebSourceSnapshot, pendingWebSourceOperations } from "@/lib/creation/client/pending-web-source";
import { webFileAction } from "@/lib/creation/client/web-files";
import { useWebArtifact } from "./useWebArtifact";
import { usePendingTextDraft } from "./usePendingTextDraft";
import DraftSessionGate from "./DraftSessionGate";
import WebPreview from "./WebPreview";
import "./web-editor.css";

const ExportDialog = lazy(() => import("./ExportDialog"));
const WebVisualEditor = lazy(() => import("./WebVisualEditor"));
const WebFileDialog = lazy(() => import("./WebFileDialog"));
const WebImagePicker = lazy(() => import("./WebImagePicker"));
const WebImageFile = lazy(() => import("./WebImageFile"));

export default function WebArtifactEditor(props) {
  return <DraftSessionGate userId={props.userId} artifactId={props.artifactId} editorRef={props.editorRef} zh={props.zh}>{(draftSessionId, onDrafts) => <Session key={draftSessionId} {...props} draftSessionId={draftSessionId} onDrafts={onDrafts} />}</DraftSessionGate>;
}
function Session({ artifactId, userId, draftSessionId, onDrafts, zh = true, onError, onReference, onArtifactCreated, editorRef }) {
  const editor = useWebArtifact(userId, artifactId, draftSessionId);
  const draft = usePendingTextDraft(userId, artifactId, editor.persistLocal, draftSessionId, pendingWebSourceSnapshot);
  const [selectedId, setSelectedId] = useState(null), [pageId, setPageId] = useState(null), [view, setView] = useState("preview"), [mode, setMode] = useState("desktop");
  const [live, setLive] = useState(null), [busy, setBusy] = useState(false), [history, setHistory] = useState(null);
  const [discarding, setDiscarding] = useState(false), [exportOpen, setExportOpen] = useState(false);
  const [publication, setPublication] = useState(null), [publicationError, setPublicationError] = useState(null), [publicationLoading, setPublicationLoading] = useState(false);
  const [fileDialog, setFileDialog] = useState(null), [filePersistenceError, setFilePersistenceError] = useState(null);
  const [imagePicker, setImagePicker] = useState(null);
  const gate = useRef(false), lifetime = useRef(null), restorePending = editor.restorePending;
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => controller.abort(); }, []);
  const loadPublication = useCallback(async signal => {
    if (!artifactId) return;
    setPublicationLoading(true);
    try {
      const value = await api(`/api/creation/artifacts/${encodeURIComponent(artifactId)}/publication`, { signal });
      if (!signal?.aborted) { setPublication(value); setPublicationError(null); }
    } catch (error) {
      if (!signal?.aborted) setPublicationError(error);
    } finally {
      if (!signal?.aborted) setPublicationLoading(false);
    }
  }, [artifactId]);
  useEffect(() => {
    const controller = new AbortController();
    void loadPublication(controller.signal);
    return () => controller.abort();
  }, [loadPublication]);
  const text = (cn, en) => zh ? cn : en;
  const file = editor.content?.files.find(file => file.id === selectedId) || editor.content?.files.find(file => file.path === editor.content.entryPath);
  const page = editor.content?.files.find(file => file.id === pageId && file.kind === "html") || editor.content?.files.find(file => file.path === editor.content.entryPath);
  const currentLive = live && draft.ready && !draft.recovery ? live : null;
  const disabled = !editor.ready || !draft.ready || busy || Boolean(draft.recovery) || Boolean(restorePending) || ["loading", "conflict", "copying"].includes(editor.status);
  useEffect(() => {
    if (!live && !draft.recovery) return;
    const warn = event => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [live, draft.recovery]);
  const commit = useCallback(async () => {
    if (!editor.ready || !draft.ready || draft.recovery) throw new Error("TEXT_DRAFT_REVIEW_REQUIRED");
    const pending = draft.snapshot();
    if (pending) {
      const operations = pendingWebSourceOperations(editor.getContent(), pending);
      if (operations.length && editor.change(operations) === false) throw new Error("ARTIFACT_NOT_READY");
      // Clear only after the operation journal has reached local persistence.
      await draft.clear(); setLive(null);
    }
  }, [editor, draft]);
  const flush = useCallback(async () => {
    if (gate.current || editor.restorePending) throw new Error("ARTIFACT_NOT_READY");
    gate.current = true; setBusy(true);
    try { await commit(); const saved = await editor.flush(); setFilePersistenceError(null); return saved; }
    finally { gate.current = false; setBusy(false); }
  }, [commit, editor]);
  useImperativeHandle(editorRef, () => ({ flush }), [flush]);
  async function perform(action) {
    if (gate.current) return;
    gate.current = true; setBusy(true);
    try { await action(); } catch (error) { onError?.(error); }
    finally { gate.current = false; setBusy(false); }
  }
  function update(value, composing = false) {
    const base = draft.snapshot() || { kind: "web-source", fileId: file.id, path: file.path, fileKind: file.kind, original: file.content };
    const next = { ...base, text: value, composing };
    draft.change(next); setLive(next); setDiscarding(false);
  }
  function updateVisual(draftValue) {
    if (disabled || draftValue?.fileId !== page?.id) return;
    draft.change(draftValue); setLive(draftValue); setDiscarding(false);
  }
  async function switchFile(next) { await commit(); setSelectedId(next.id); }
  async function manageFile(request) {
    if (gate.current || disabled) throw new Error("ARTIFACT_NOT_READY");
    gate.current = true; setBusy(true);
    try {
      await commit();
      const content = editor.getContent(), signal = lifetime.current?.signal;
      let result;
      if (request.action === "rename") result = await (await import("@/lib/creation/client/web-source-worker")).runWebSourceTask("rename", { content, request }, { signal });
      else if (request.action === "images") result = (await import("@/lib/creation/client/web-image-files")).prepareWebImageFiles(content, request.items, { target: request.target });
      else if (request.action === "insertImage") result = await (await import("@/lib/creation/client/web-source-worker")).runWebSourceTask("insertImage", { content, target: request.target, page: request.page }, { signal });
      else result = webFileAction(content, request);
      if (signal?.aborted) throw new Error("ARTIFACT_CLOSED");
      if (editor.getContent() !== content) throw new Error("WEB_SOURCE_CHANGED");
      if (result.operations.length && editor.change(result.operations) === false) throw new Error("ARTIFACT_NOT_READY");
      setSelectedId(result.selectedId);
      const selected = editor.getContent().files.find(item => item.id === result.selectedId);
      if (selected.kind === "html") setPageId(selected.id);
      // The change is already applied in memory. A failed local write must
      // never leave a dialog offering to create/delete the same file again.
      try { await editor.persistLocal(); setFilePersistenceError(null); }
      catch (error) { setFilePersistenceError(error); onError?.(error); }
    } finally { gate.current = false; setBusy(false); }
  }
  async function refer() {
    await commit();
    if (!["html", "css"].includes(file.kind)) return;
    onReference?.({ kind: "web", fileIds: [file.id], paths: [file.path], label: file.path });
  }
  async function recover() {
    const value = { ...draft.recovery, composing: false };
    const source = editor.getContent()?.files.find(file => file.id === value.fileId && file.path === value.path && file.kind === value.fileKind);
    if (!source) throw new Error("WEB_SOURCE_CHANGED");
    draft.change(value); draft.acceptRecovery(); setLive(value); setSelectedId(source.id); setView("code");
  }
  async function copy() {
    if (!draft.ready) throw new Error("TEXT_DRAFT_REVIEW_REQUIRED");
    const pending = draft.recovery ? { ...draft.recovery, composing: false } : draft.snapshot();
    const saved = await editor.saveConflictCopy(`${editor.content.title.slice(0, 140)}${text("（本地副本）", " (local copy)")}`, pending);
    await draft.clear(); setLive(null); onArtifactCreated?.(saved);
  }
  async function loadHistory(before) {
    const result = await api(`/api/creation/artifacts/${encodeURIComponent(artifactId)}/revisions${before ? `?before=${before}` : ""}`);
    setHistory(current => ({ ...result, items: before ? [...current.items, ...result.items] : result.items }));
  }
  async function publicationAction(action, targetRevision) {
    if (action === "publish" && !window.confirm(text("发布后，任何获得链接的人都可以访问此网站。确认发布？", "Anyone with the link will be able to access this website. Publish it?"))) return;
    if (action === "revoke" && !window.confirm(text("撤回后，公开链接将立即停止访问。确认撤回？", "The public link will stop working after revocation. Revoke it?"))) return;
    await perform(async () => {
      const saved = action === "publish" ? await flush() : null;
      const expectedRevision = publication?.currentRevision ?? null;
      const result = await api(`/api/creation/artifacts/${encodeURIComponent(artifactId)}/publication`, { method: "POST", body: {
        action, expectedRevision, saveKey: requestKey(), ...(action === "publish" ? { sourceRevision: saved.revision } : {}), ...(action === "rollback" ? { targetRevision } : {}),
      } });
      setPublication(result); setPublicationError(null);
    });
  }
  async function restore(revision) {
    if (!editor.restorePending) { await commit(); await editor.flush(); }
    await editor.restoreRevision(revision);
  }
  const state = draft.recovery ? text("发现未完成的编辑", "Unfinished edits found") : currentLive ? text("修改尚未应用", "Unapplied edits")
    : ({ saved: text("已保存", "Saved"), local: text("有未同步修改", "Unsynced changes"), saving: text("正在保存…", "Saving…"), conflict: text("云端已有新版本", "New cloud version"), error: text("保存失败", "Save failed") }[editor.status] || text("正在打开…", "Opening…"));
  return <section className="cw-artifact cw-web" aria-label={text("网页编辑区", "Website editor")}>
    <header className="cw-artifact-bar"><div><strong>{editor.content?.title || text("网页", "Website")}</strong>{editor.revision && <span>V{editor.revision}</span>}</div><span role="status" className="cw-save-state">{state}</span>
      <button disabled={disabled} onClick={() => void flush().catch(error => onError?.(error))}><Save size={15} />{text("保存", "Save")}</button>
      <button disabled={disabled || !publication || publication.status === "published"} onClick={() => void publicationAction("publish")}>{text("发布", "Publish")}</button>
      {publication?.status === "published" && <button disabled={busy} onClick={() => void publicationAction("revoke")}>{text("撤回", "Revoke")}</button>}
      <button disabled={!editor.content} onClick={() => setExportOpen(true)}><Download size={15} />{text("导出", "Export")}</button>
      <button disabled={busy} onClick={() => void perform(() => loadHistory())}><History size={15} />{text("版本", "Versions")}</button>
      <button disabled={disabled} onClick={() => void perform(async () => { await commit(); await editor.flush(); await draft.flush(); onDrafts(); })}>{text("本地草稿", "Local drafts")}</button>
    </header>
    {(publicationError || publication) && <section className="cw-web-publication" aria-label={text("网站发布", "Website publication")}>
      {publicationError ? <><span role="alert">{text("发布信息读取失败", "Could not load publication status")}</span><button disabled={publicationLoading} onClick={() => void loadPublication()}>{text("重试", "Retry")}</button></> : <>
        <span>{publication.status === "published" ? text(`已发布 V${publication.currentRevision}`, `Published V${publication.currentRevision}`) : text("未发布", "Not published")}</span>
        {publication.url && <a href={publication.url} target="_blank" rel="noreferrer">{publication.url}</a>}
        {publication.revisions?.length > 0 && <details><summary>{text("发布版本", "Published versions")}</summary><ol>{publication.revisions.map(item => <li key={item.revision}>
          <span>{text(`发布 V${item.revision}（作品 V${item.sourceRevision}）`, `Publication V${item.revision} (site V${item.sourceRevision})`)}</span>
          {publication.status === "published" && item.revision !== publication.currentRevision && <button disabled={busy} onClick={() => void publicationAction("rollback", item.revision)}>{text("回滚到此版本", "Restore this version")}</button>}
        </li>)}</ol></details>}
      </>}
    </section>}
    {(editor.error || draft.error) && <div role="alert" className="cw-error"><span>{text("保存或恢复未能完成，当前修改已保留在页面中。", "Save or recovery failed. Your edits remain on this page.")}</span><button disabled={busy} onClick={() => { if (draft.error) draft.retry(); else editor.retry(); }}>{text("重试", "Retry")}</button></div>}
    {filePersistenceError && <div role="alert" className="cw-error"><span>{text("文件操作已在当前页面生效，但本地草稿写入失败，请保存或重试后再离开。", "The file change is applied on this page, but its local draft could not be written. Save or retry before leaving.")}</span><button disabled={busy} onClick={() => void perform(async () => { await editor.persistLocal(); setFilePersistenceError(null); })}>{text("重试写入草稿", "Retry draft write")}</button></div>}
    {restorePending && <div className="cw-error" role="alert"><span>{text("版本恢复结果尚未确认，请重试核对。", "Version restoration is unconfirmed. Retry to check the same request.")}</span><button disabled={busy} onClick={() => void perform(() => restore(restorePending.restoreRevision))}>{text("重试恢复", "Retry restoration")}</button></div>}
    {draft.recovery && <div className="cw-web-recovery"><strong>{text("恢复未完成的文件编辑", "Recover unfinished source")}: {draft.recovery.path}</strong><textarea aria-label={text("待恢复源码", "Source to recover")} readOnly value={draft.recovery.text} /><div><button disabled={busy || !editor.ready} onClick={() => void perform(recover)}>{text("继续编辑", "Continue editing")}</button><button disabled={busy} onClick={() => void perform(async () => { await draft.clear(); setLive(null); })}>{text("放弃此草稿", "Discard this draft")}</button></div></div>}
    {["conflict", "copying"].includes(editor.status) && <div className="cw-error" role="alert"><span>{text("其他位置已修改此作品。可以把本地内容保存为副本。", "This site changed elsewhere. Save your edits as a separate copy.")}</span><button disabled={busy || editor.status === "copying" || !draft.ready} onClick={() => void perform(copy)}>{text("保留本地副本", "Keep local copy")}</button></div>}
    {editor.content && file ? <>
      <nav className="cw-web-toolbar" aria-label={text("网页工具", "Website tools")}>
        <button aria-pressed={view === "preview"} disabled={disabled} onClick={() => void perform(async () => { await commit(); setView("preview"); })}><Eye size={15} />{text("预览", "Preview")}</button>
        <button aria-pressed={view === "visual"} disabled={disabled} onClick={() => void perform(async () => { await commit(); if (view === "code" && file.kind === "html") setPageId(file.id); setView("visual"); })}><MousePointer2 size={15} />{text("可视化", "Visual")}</button>
        <button aria-pressed={view === "code"} disabled={busy || Boolean(restorePending) || Boolean(currentLive?.composing)} onClick={() => { if (view !== "code") setSelectedId(currentLive?.fileId || page.id); setView("code"); }}><Code size={15} />{text("代码", "Code")}</button>
        <span className="cw-web-toolbar-gap" />
        {view !== "code" && <><select aria-label={text("预览页面", "Preview page")} disabled={disabled} value={page.id} onChange={event => { const id = event.target.value; void perform(async () => { await commit(); setPageId(id); setSelectedId(id); }); }}>{editor.content.files.filter(file => file.kind === "html").map(file => <option key={file.id} value={file.id}>{file.path}</option>)}</select><button aria-label={text("桌面预览", "Desktop preview")} aria-pressed={mode === "desktop"} onClick={() => setMode("desktop")}><Monitor size={16} /></button><button aria-label={text("手机预览", "Mobile preview")} aria-pressed={mode === "mobile"} onClick={() => setMode("mobile")}><Smartphone size={16} /></button></>}
        {view !== "preview" && <><button disabled={disabled || !editor.undoCount || Boolean(currentLive)} aria-label={text("撤销", "Undo")} onClick={() => void perform(async () => editor.undo())}><Undo2 size={15} /></button><button disabled={disabled || !editor.redoCount || Boolean(currentLive)} aria-label={text("重做", "Redo")} onClick={() => void perform(async () => editor.redo())}><Redo2 size={15} /></button></>}
      </nav>
      {view === "preview" ? <WebPreview content={editor.content} pageId={pageId} mode={mode} zh={zh} /> : view === "visual" ? <Suspense fallback={<div className="cw-loading" role="status">{text("正在打开可视化编辑器…", "Opening visual editor…")}</div>}><WebVisualEditor content={editor.content} pageId={pageId} mode={mode} zh={zh} readOnly={disabled} hasPending={Boolean(currentLive)} onDraft={updateVisual} onApply={() => void perform(commit)} onError={onError} /></Suspense> : <div className="cw-web-source"><nav aria-label={text("网页文件", "Website files")}><button disabled={disabled || editor.content.files.length >= 100} onClick={() => setFileDialog({ action: "create" })}><FilePlus2 size={14} />{text("新建文件", "New file")}</button><button disabled={disabled || editor.content.files.length >= 100} onClick={() => setImagePicker({})}><ImagePlus size={14} />{text("添加图片", "Add images")}</button>{editor.content.files.map(item => <button key={item.id} aria-current={item.id === file.id ? "true" : undefined} disabled={disabled} onClick={() => void perform(() => switchFile(item))}><Code size={13} /><span>{item.path}</span></button>)}</nav><div className="cw-web-source-main"><header><strong>{file.path}</strong><div className="cw-web-file-actions">{file.kind === "asset" && <button disabled={disabled} onClick={() => setImagePicker({ target: file })}><ImagePlus size={13} />{text("替换图片", "Replace image")}</button>}{file.path === editor.content.entryPath ? <span className="cw-web-entry"><House size={13} />{text("首页", "Entry page")}</span> : file.kind === "html" && <button disabled={disabled} onClick={() => void manageFile({ action: "entry", fileId: file.id, path: file.path }).catch(error => onError?.(error))}><House size={13} />{text("设为首页", "Set as entry")}</button>}<button disabled={disabled} onClick={() => setFileDialog({ action: "rename", file })}><Pencil size={13} />{text("重命名", "Rename")}</button><button disabled={disabled || editor.content.files.length >= 100} onClick={() => setFileDialog({ action: "duplicate", file })}><Copy size={13} />{text("复制文件", "Duplicate file")}</button><button disabled={disabled || file.path === editor.content.entryPath} onClick={() => setFileDialog({ action: "delete", file })}><Trash2 size={13} />{text("删除文件", "Delete file")}</button></div>{["html", "css"].includes(file.kind) && <button disabled={disabled} onClick={() => void perform(refer)}>{text("交给 AI 修改", "Ask AI to edit")}</button>}</header>{file.kind === "asset" ? <Suspense fallback={<p role="status">{text("正在打开图片…", "Opening image…")}</p>}><WebImageFile key={file.id} file={file} page={page} pages={editor.content.files.filter(item => item.kind === "html")} zh={zh} readOnly={disabled} onPage={setPageId} onInsert={() => void manageFile({ action: "insertImage", target: file, page }).catch(error => onError?.(error))} /></Suspense> : <textarea aria-label={text("文件源码", "File source")} disabled={disabled} value={currentLive?.fileId === file.id ? currentLive.text : file.content} spellCheck={false} autoCapitalize="off" autoCorrect="off" maxLength={512 * 1024} onChange={event => update(event.target.value, event.nativeEvent.isComposing || currentLive?.composing)} onCompositionStart={event => update(event.currentTarget.value, true)} onCompositionEnd={event => update(event.currentTarget.value, false)} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === "s") { event.preventDefault(); void flush().catch(error => onError?.(error)); } }} />}<footer><span>{file.kind === "js" ? text("脚本保存在文件中，当前预览不执行脚本。", "Scripts are stored but not executed in this preview.") : text("应用后更新预览，未完成的输入会保留为本地草稿。", "Apply to update the preview. Unfinished input is kept as a local draft.")}</span>{currentLive && (discarding ? <><span>{text("放弃当前尚未应用的输入？", "Discard this unapplied input?")}</span><button disabled={busy} onClick={() => void perform(async () => { await draft.clear(); setLive(null); setDiscarding(false); })}>{text("确认放弃", "Confirm discard")}</button><button onClick={() => setDiscarding(false)}>{text("取消", "Cancel")}</button></> : <button disabled={busy} onClick={() => setDiscarding(true)}>{text("放弃输入", "Discard input")}</button>)}<button disabled={disabled || !currentLive} onClick={() => void perform(commit)}>{text("应用修改", "Apply changes")}</button></footer></div></div>}
    </> : <div className="cw-loading" role="status">{text("正在读取网页…", "Loading website…")}</div>}
    {exportOpen && <Suspense fallback={<p role="status">{text("正在打开导出…", "Opening export…")}</p>}><ExportDialog artifactId={artifactId} userId={userId} kind="web" onFlush={flush} onClose={() => setExportOpen(false)} zh={zh} /></Suspense>}
    {fileDialog && <Suspense fallback={<p role="status">{text("正在打开文件操作…", "Opening file action…")}</p>}><WebFileDialog {...fileDialog} content={editor.content} zh={zh} onSubmit={manageFile} onClose={() => setFileDialog(null)} /></Suspense>}
    {imagePicker && <Suspense fallback={<p role="status">{text("正在打开素材库…", "Opening assets…")}</p>}><WebImagePicker target={imagePicker.target} maxSelection={Math.min(8, 100 - editor.content.files.length)} zh={zh} onSelect={(items, target) => manageFile({ action: "images", items, target })} onClose={() => setImagePicker(null)} /></Suspense>}
    {history && <aside className="cw-version-panel" aria-label={text("版本历史", "Version history")}><header><strong>{text("版本历史", "Version history")}</strong><button aria-label={text("关闭版本历史", "Close history")} onClick={() => setHistory(null)}><X size={16} /></button></header><p>{text("恢复会新增版本，并保留已有历史。", "Restore adds a new revision and keeps the history.")}</p>{history.items.map(item => <div className="cw-version-row" key={item.revision}><div><strong>V{item.revision}</strong><time>{new Date(item.createdAt).toLocaleString(zh ? "zh-CN" : "en-US")}</time></div><button disabled={disabled || item.revision === editor.revision} onClick={() => void perform(() => restore(item.revision))}>{text("恢复", "Restore")}</button></div>)}{history.nextCursor && <button disabled={busy} onClick={() => void perform(() => loadHistory(history.nextCursor))}>{text("更早版本", "Earlier versions")}</button>}</aside>}
  </section>;
}
