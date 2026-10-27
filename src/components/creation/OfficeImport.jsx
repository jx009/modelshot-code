"use client";

import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileUp, LoaderCircle } from "lucide-react";
import { api, requestKey } from "@/lib/client-api";
import { creationError } from "./creation-errors";
import { officeImportBytes, officeImportExtension as extension } from "@/lib/creation/office/import-policy";
import "./office-import.css";

const active = item => ["queued", "running"].includes(item.status);
export default function OfficeImport({ projectId, kind, zh, onSelect, onImported, controllerRef, dropTarget, compact = false, disabled = false }) {
  const [state, setState] = useState({ items: [], enabled: false }), [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const [opened, setOpened] = useState(false), [dragSurface, setDragSurface] = useState(null), [ready, setReady] = useState(false);
  const [popupPosition, setPopupPosition] = useState({});
  const life = useRef(null), upload = useRef(null), callbacks = useRef({ onImported, onSelect });
  const input = useRef(null), lock = useRef(false), owned = useRef(new Set()), actions = useRef(null);
  useLayoutEffect(() => {
    callbacks.current = { onImported, onSelect };
    actions.current = { submit, disabled };
  });
  const maxBytes = Math.min(state.maxBytes || officeImportBytes(kind), officeImportBytes(kind));
  const limit = maxBytes / 1024 / 1024;
  useImperativeHandle(controllerRef, () => ({ open: () => { setOpened(true); input.current?.click(); } }));
  const endpoint = "/api/creation/projects/" + encodeURIComponent(projectId) + "/imports";
  useEffect(() => {
    const controller = new AbortController(); life.current = controller;
    lock.current = false;
    queueMicrotask(() => { if (!controller.signal.aborted) setBusy(false); });
    let timer, known = new Map(), first = true, polling = false, again = false;
    async function poll() {
      if (polling) { again = true; return; }
      polling = true;
      try {
        const result = await api(endpoint, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setState(result); setReady(true);
        const completed = !first && result.items.some(item => item.status === "succeeded" && known.get(item.id) !== "succeeded");
        const ownCompleted = result.items.filter(item => item.status === "succeeded" && item.artifactId && owned.current.has(item.id));
        known = new Map(result.items.map(item => [item.id, item.status])); first = false;
        if (completed || ownCompleted.length) await callbacks.current.onImported?.();
        if (ownCompleted.length && !controller.signal.aborted) {
          for (const item of ownCompleted) owned.current.delete(item.id);
          // Never interrupt edits or generation that started during conversion.
          // The completed file remains available through the Open button.
          if (!actions.current.disabled) await callbacks.current.onSelect?.(ownCompleted[0].artifactId, false, kind);
        }
        if (!controller.signal.aborted && result.items.some(active)) timer = setTimeout(poll, document.visibilityState === "hidden" ? 10000 : 2500);
      } catch (failure) {
        if (!controller.signal.aborted) { setError(failure); timer = setTimeout(poll, 10000); }
      } finally {
        polling = false;
        if (again && !controller.signal.aborted) { again = false; clearTimeout(timer); timer = setTimeout(poll, 0); }
      }
    }
    const refresh = () => { clearTimeout(timer); setError(null); void poll(); };
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    life.current.refresh = refresh;
    document.addEventListener("visibilitychange", onVisible);
    void poll();
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [endpoint, kind]);
  useEffect(() => {
    const target = dropTarget?.current; if (!target) return;
    let depth = 0;
    const files = event => Array.from(event.dataTransfer?.types || []).includes("Files");
    const enter = event => { if (!files(event)) return; event.preventDefault(); depth++; setDragSurface(target); };
    const over = event => { if (files(event)) { event.preventDefault(); event.dataTransfer.dropEffect = actions.current.disabled || lock.current ? "none" : "copy"; } };
    const leave = event => { if (!files(event)) return; if (--depth <= 0) { depth = 0; setDragSurface(null); } };
    const clear = () => { depth = 0; setDragSurface(null); };
    const drop = event => {
      if (!files(event)) return; event.preventDefault(); clear(); setOpened(true);
      if (actions.current.disabled) return;
      const items = [...(event.dataTransfer.files || [])];
      if (items.length !== 1) { setError({ code: "OFFICE_IMPORT_SINGLE_FILE" }); return; }
      void actions.current.submit(items[0]);
    };
    for (const [name, handler] of Object.entries({ dragenter: enter, dragover: over, dragleave: leave, drop })) target.addEventListener(name, handler);
    window.addEventListener("blur", clear);
    return () => { for (const [name, handler] of Object.entries({ dragenter: enter, dragover: over, dragleave: leave, drop })) target.removeEventListener(name, handler); window.removeEventListener("blur", clear); };
  }, [dropTarget]);
  async function submit(file) {
    if (lock.current || disabled || !file) return;
    setOpened(true);
    if (file.size > maxBytes) { setError({ code: "OFFICE_SOURCE_LIMIT" }); return; }
    const ext = extension(kind);
    if (!file.name.toLowerCase().endsWith(ext)) { setError({ code: "OFFICE_FORMAT_UNSUPPORTED" }); return; }
    if (!ready || !state.enabled) { setError({ code: "OFFICE_WORKER_UNAVAILABLE" }); return; }
    if (upload.current?.file !== file) upload.current = { file, key: requestKey() };
    lock.current = true; setBusy(true); setError(null);
    const signal = life.current.signal;
    try {
      const body = new FormData(); body.set("file", file);
      const item = await api(endpoint, { method: "POST", body, key: upload.current.key, signal, timeoutMs: 120000 });
      if (signal.aborted) return;
      upload.current = null;
      if (compact) owned.current.add(item.id);
      setState(current => ({ ...current, items: [item, ...current.items.filter(old => old.id !== item.id)].slice(0, 12) }));
      life.current.refresh();
    } catch (failure) { if (!signal.aborted) setError(failure); }
    finally { if (!signal.aborted) { lock.current = false; setBusy(false); } }
  }
  async function cancel(id) {
    try { await api("/api/creation/imports/" + encodeURIComponent(id), { method: "DELETE", signal: life.current.signal }); life.current.refresh(); }
    catch (failure) { if (!life.current.signal.aborted) setError(failure); }
  }
  return <div className={compact ? "cw-office-control" : "cw-office-inline"}>
    {compact && <button type="button" onClick={() => { setOpened(true); input.current?.click(); }} disabled={busy || disabled || !ready || !state.enabled} title={zh ? `拖入 PPTX 即可导入并编辑，最大 ${limit} MiB` : `Drop PPTX to import and edit, up to ${limit} MiB`}>{busy || state.items.some(active) ? <LoaderCircle size={14} className="animate-spin" /> : <FileUp size={14} />}{zh ? "导入 PPT" : "Import PPT"}</button>}
    <details className="cw-office-import" style={compact ? popupPosition : undefined} data-has-status={busy || Boolean(error) || state.items.length > 0 || ready && !state.enabled} open={opened} onToggle={event => {
      setOpened(event.currentTarget.open);
      if (compact && event.currentTarget.open) {
        const anchor = event.currentTarget.parentElement.getBoundingClientRect();
        setPopupPosition({ left: Math.max(16, Math.min(anchor.left, window.innerWidth - 376)), bottom: window.innerHeight - anchor.top + 8, maxHeight: Math.max(100, anchor.top - 24) });
      }
    }}><summary>{zh ? compact ? "导入进度" : "导入 Office 文件" : compact ? "Import status" : "Import Office"}</summary>
    <label>{zh ? `原件保留 · 最大 ${limit} MiB` : `Original retained · up to ${limit} MiB`}<input ref={input} type="file" aria-label={zh ? "导入 Office 文件" : "Import Office file"} accept={extension(kind)} disabled={busy || disabled || !state.enabled} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void submit(file); }} /></label>
    {!ready ? <small>{zh ? "正在检查导入服务…" : "Checking import service…"}</small> : !state.enabled && <small>{zh ? "导入服务尚未就绪，已有文件仍可打开。" : "Import service is unavailable. Existing files remain accessible."}<button type="button" onClick={() => life.current.refresh()}>{zh ? "重新检查" : "Check again"}</button></small>}
    {kind === "slides" && <p className="cw-office-hint">{zh ? "PPTX 导入后会建立可编辑副本，保留原文件。打开后可修改文字、图片，也可选中页面使用 AI 编辑。旧版 .ppt 请先另存为 .pptx。" : "Import PPTX as an editable copy; the original is retained. Edit text and images, or select a page for AI edits. Save older .ppt files as .pptx first."}</p>}
    {busy && <p role="status">{zh ? "正在上传…" : "Uploading…"}</p>}
    {error && <div role="alert">{creationError(error, zh)}<button type="button" disabled={busy} onClick={() => upload.current ? submit(upload.current.file) : life.current.refresh()}>{zh ? "重试" : "Retry"}</button></div>}
    {state.items.map(item => <div key={item.id}><span title={item.name}>{item.name}</span><small role="status">{({ queued: ["等待转换", "Queued for conversion"], running: ["正在转换可编辑内容…", "Converting editable content…"], succeeded: ["已导入，可打开编辑", "Imported — ready to edit"], failed: ["导入失败", "Import failed"], cancelled: ["已取消", "Cancelled"] })[item.status]?.[zh ? 0 : 1]}</small>
      {item.artifactId && <button type="button" disabled={disabled} onClick={() => compact ? callbacks.current.onSelect?.(item.artifactId, false, kind) : callbacks.current.onSelect?.(item.artifactId)}>{zh ? "打开" : "Open"}</button>}
      {active(item) && <button type="button" onClick={() => cancel(item.id)}>{zh ? "取消" : "Cancel"}</button>}
      <a href={item.sourceUrl} download>{zh ? "原件" : "Original"}</a>
      {item.errorCode && <p>{creationError({ code: item.errorCode }, zh)}</p>}
      {item.warnings.length > 0 && <details><summary>{zh ? "兼容提示" : "Compatibility"} ({item.warnings.length})</summary><p>{kind === "slides" ? zh ? "原始 PPTX 已保留。未转换的对象只在原件中存在，不会出现在可编辑副本里。" : "The original PPTX is retained. Unsupported objects remain only in the original and are absent from the editable copy." : zh ? "复杂对象保留在原件中；受保护范围不能修改。" : "Complex objects are retained in the original; protected ranges cannot be edited."}</p><ul>{item.warnings.map(w => <li key={w}>{w}</li>)}</ul></details>}
    </div>)}
  </details>
    {dragSurface && createPortal(<div className="cw-office-drop" role="status"><FileUp size={34} /><strong>{disabled || busy ? zh ? "请先完成当前操作" : "Finish the current operation first" : zh ? "松开导入 PPT" : "Drop to import PPT"}</strong><span>{zh ? "保留原稿 · 建立可编辑副本" : "Keep original · Create an editable copy"}</span></div>, dragSurface)}
  </div>;
}
