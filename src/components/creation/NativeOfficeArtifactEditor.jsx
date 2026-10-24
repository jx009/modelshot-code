"use client";

import { lazy, Suspense, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Download, Save } from "lucide-react";
import DraftSessionGate from "./DraftSessionGate";
import NativeInputRecovery from "./NativeInputRecovery";
import { useEditorReadiness } from "./useEditorReadiness";
import { creationError } from "./creation-errors";
import { createNativeOfficeSession } from "@/lib/creation/client/native-office-session";
import { createNativeOfficeController } from "@/lib/creation/client/native-office-controller";
import { loadNativeOfficeRuntime } from "@/lib/creation/client/native-office-loader";
import "./native-office.css";

const ExportDialog = lazy(() => import("./ExportDialog"));

export default function NativeOfficeArtifactEditor(props) {
  return <DraftSessionGate key={`${props.userId}:${props.artifactId}`} {...props}>
    {draftSessionId => <NativeSession {...props} draftSessionId={draftSessionId} />}
  </DraftSessionGate>;
}
function NativeSession({ userId, artifactId, draftSessionId, kind, zh = true, editorRef, onError, onArtifactCreated, onOpenArtifact, onReference, canReferenceNative = false }) {
  const container = useRef(null), controller = useRef(null), callbacks = useRef(null);
  const [state, setState] = useState({ status: "loading", ready: false }), [failure, setFailure] = useState(null), [busy, setBusy] = useState(false), [attempt, setAttempt] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const { ready, setReady, isReady } = useEditorReadiness();
  const text = (cn, en) => zh ? cn : en;
  useEffect(() => { callbacks.current = { onError, onArtifactCreated, onOpenArtifact, onReference }; }, [onError, onArtifactCreated, onOpenArtifact, onReference]);
  useEffect(() => {
    const abort = new AbortController();
    setReady(false);
    const session = createNativeOfficeSession({ userId, artifactId, draftSessionId, signal: abort.signal, onState: () => instance.changed() });
    const instance = createNativeOfficeController({ session, loadRuntime: loadNativeOfficeRuntime, container: container.current, kind, locale: zh ? "zh" : "en", signal: abort.signal,
      onState: value => { if (!abort.signal.aborted) { setState(value); setReady(value.ready); } },
      onError: error => { if (!abort.signal.aborted) { setFailure(error); callbacks.current?.onError?.(error); } },
    });
    controller.current = instance;
    void instance.open().then(() => {
      // Activity retains React state, but the old controller's pending action
      // belongs to a disposed lifetime. Recovered journals determine readiness.
      if (!abort.signal.aborted) { setBusy(false); setFailure(null); }
    }).catch(error => { if (!abort.signal.aborted) { setBusy(false); setFailure(error); } });
    const unload = event => { if (instance.hasUnsaved()) { event.preventDefault(); event.returnValue = ""; } };
    const visibility = () => { if (document.visibilityState === "hidden") void instance.persist(); };
    window.addEventListener("beforeunload", unload); document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("beforeunload", unload); document.removeEventListener("visibilitychange", visibility);
      instance.dispose(); abort.abort(); controller.current = null; setReady(false);
    };
  }, [userId, artifactId, draftSessionId, kind, zh, setReady, attempt]);
  const flush = useCallback(async () => {
    if (!isReady() || !controller.current) throw new Error("ARTIFACT_NOT_READY");
    return controller.current.flush();
  }, [isReady]);
  useImperativeHandle(editorRef, () => ({ flush }), [flush]);
  async function save() {
    const instance = controller.current;
    setBusy(true); setFailure(null);
    try { await flush(); } catch (error) { if (controller.current === instance) { setFailure(error); callbacks.current?.onError?.(error); } }
    finally { if (controller.current === instance) setBusy(false); }
  }
  async function copy() {
    const instance = controller.current;
    setBusy(true); setFailure(null);
    try {
      const result = await instance.copy(`${state.content.title.slice(0, 140)}${text("（本地副本）", " (local copy)")}`);
      if (controller.current === instance) callbacks.current?.onArtifactCreated?.(result);
    } catch (error) { if (controller.current === instance) { setFailure(error); callbacks.current?.onError?.(error); } }
    finally { if (controller.current === instance) setBusy(false); }
  }
  async function reference() {
    const instance = controller.current;
    setBusy(true); setFailure(null);
    try {
      const selected = await instance.reference();
      if (controller.current === instance) callbacks.current?.onReference?.({ ...selected, artifactId,
        label: kind === "sheet" ? `${selected.sheetName} · ${selected.cells.length} ${text("个单元格", "cells")}`
          : `${text("文档选区", "Document selection")} · ${selected.spans.reduce((sum, span) => sum + span.expectedText.length, 0)} ${text("字符", "characters")}` });
    } catch (error) { if (controller.current === instance) { setFailure(error); callbacks.current?.onError?.(error); } }
    finally { if (controller.current === instance) setBusy(false); }
  }
  async function dismissInputs() {
    const instance = controller.current;
    setBusy(true); setFailure(null);
    try { await instance.dismissRecoveredInputs(); }
    catch (error) { if (controller.current === instance) setFailure(error); }
    finally { if (controller.current === instance) setBusy(false); }
  }
  const statuses = { loading: ["正在载入…", "Loading…"], saved: ["已保存", "Saved"], local: ["待同步", "Unsynced"], saving: ["正在保存…", "Saving…"], conflict: ["版本冲突，本地修改保留", "Version conflict; local edits retained"], error: ["保存未确认", "Save unconfirmed"], copying: ["正在另存副本…", "Saving a copy…"], copied: ["副本已保存", "Copy saved"] };
  const error = failure || state.error || state.fatal;
  const recovering = Boolean(state.recoveredInputs?.length);
  const imported = state.content?.snapshot?.custom?.modelshot?.officeImport;
  return <section className="cw-native-artifact" aria-label={text(kind === "sheet" ? "表格编辑器" : "文档编辑器", kind === "sheet" ? "Spreadsheet editor" : "Document editor")}>
    <header className="cw-native-toolbar"><strong>{state.content?.title || text("作品", "Artwork")}</strong><span role="status">{recovering ? text("待处理输入备份", "Input backup needs review") : state.inputPending ? text("输入待确认", "Input awaiting confirmation") : state.unsnapshotted ? text("有未保存修改", "Unsaved changes") : text(...(statuses[state.status] || statuses.loading))}{state.revision ? ` · V${state.revision}` : ""}</span><button disabled={!ready || busy || recovering || Boolean(state.fatal) || ["conflict", "copied", "copying"].includes(state.status)} onClick={save}><Save size={14} />{text("保存", "Save")}</button>{!["conflict", "copied", "copying"].includes(state.status) && <button disabled={!ready || busy || recovering || Boolean(state.fatal)} onClick={() => setExportOpen(true)}><Download size={14} />{text("导出", "Export")}</button>}</header>
    {canReferenceNative && onReference && <div className="cw-native-notice"><span>{kind === "sheet" ? text("选中最多 100 个普通单元格，再引用到对话中修改。", "Select up to 100 plain cells, then reference them in the conversation.") : text("选中文字后引用到对话，可润色、改写或翻译，并保留段落和格式。", "Reference selected text to polish, rewrite or translate while preserving paragraphs and formatting.")}</span><button disabled={!ready || busy || recovering || Boolean(state.fatal) || ["conflict", "copied", "copying"].includes(state.status)} onPointerDown={event => event.preventDefault()} onClick={reference}>{text("引用选区到对话", kind === "sheet" ? "Reference selected cells" : "Reference selected text")}</button></div>}
    {error && <div className="cw-error" role="alert">{creationError(error, zh)}{!ready && <button onClick={() => { setFailure(null); setAttempt(value => value + 1); }}>{text("重试打开", "Retry opening")}</button>}</div>}
    {recovering && <NativeInputRecovery entries={state.recoveredInputs} content={state.content} zh={zh} busy={busy || !ready} onDismiss={dismissInputs} />}
    {(state.status === "conflict" || state.copyPending && !state.copyResult) && <div className="cw-native-notice"><span>{text("请先确认正在输入的内容，再将本地修改另存为副本。", "Confirm any active input, then keep your local edits as a copy.")}</span><button disabled={!ready || busy || recovering} onClick={copy}>{text("保留修改并另存副本", "Keep edits as a copy")}</button></div>}
    {state.copyResult && <div className="cw-native-notice"><span>{text("本地修改已保存为独立副本。", "Your local edits were saved as a separate copy.")}</span>{onOpenArtifact && <button onClick={() => onOpenArtifact(state.copyResult.artifactId)}>{text("打开副本", "Open copy")}</button>}</div>}
    {!ready && !error && <div className="cw-loading" role="status">{text("正在打开编辑器…", "Opening editor…")}</div>}
    {imported && <details className="cw-import-protection"><summary>{text("原文件已保留 · 查看编辑限制", "Original retained · editing limits")}</summary><p>{text("支持修改普通文字、样式与单元格。段落增删、表格结构、复杂公式和含域/修订的段落受保护；误改后请撤销。导出原格式时保留未改动部件。", "Edit ordinary text, styles and cells. Paragraph insertion/deletion, table structure, complex formulas and fields/revisions are protected; undo unsupported changes. Original-format export retains untouched parts.")}</p><a href={"/api/creation/imports/" + encodeURIComponent(imported.sourceId) + "/source"} download>{text("下载原文件", "Download original")}</a>{imported.warnings.length > 0 && <ul>{imported.warnings.map(w => <li key={w}>{w}</li>)}</ul>}</details>}
    <div className="cw-native-office" ref={container} />
    {exportOpen && <Suspense fallback={<div role="status">{text("正在打开导出…", "Opening export…")}</div>}><ExportDialog artifactId={artifactId} userId={userId} kind={kind} sourceSchemaVersion={2} onFlush={flush} onClose={() => setExportOpen(false)} zh={zh} /></Suspense>}
  </section>;
}
