"use client";

import { useEffect, useRef, useState } from "react";
import { Download, FileText, LoaderCircle, Paperclip, X } from "lucide-react";
import { api } from "@/lib/client-api";
import { referenceType, REFERENCE_TEXT_BYTES, REFERENCE_OFFICE_BYTES } from "@/lib/creation/reference-policy";
import { referenceAssetIds } from "./ReferenceAssets";
import "./reference-assets.css";

export default function ReferenceFiles(props) {
  return props.sessionId ? <SessionReferenceFiles key={props.sessionId} {...props} /> : null;
}

function SessionReferenceFiles({ sessionId, value, onChange, disabled, zh, onError }) {
  const [items, setItems] = useState([]), [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false), [reload, setReload] = useState(0);
  const [officeEnabled, setOfficeEnabled] = useState(false);
  const input = useRef(null), uploadController = useRef(null), text = (cn, en) => zh ? cn : en;
  useEffect(() => {
    // Activity can reconnect this component without resetting its React state.
    let active = true;
    queueMicrotask(() => { if (active) setBusy(false); });
    return () => { active = false; uploadController.current?.abort(); uploadController.current = null; };
  }, []);
  useEffect(() => {
    if (!sessionId) return;
    const controller = new AbortController();
    api(`/api/creation/sessions/${encodeURIComponent(sessionId)}/references`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setItems(result.items || []); setOfficeEnabled(result.officeEnabled === true); setReady(true); } })
      .catch(error => { if (!controller.signal.aborted) onError?.(error); });
    return () => controller.abort();
  }, [sessionId, onError, reload]);
  const selected = referenceAssetIds(value);
  const byId = new Map(items.map(item => [item.id, item]));
  async function upload(event) {
    const files = [...(event.target.files || [])]; event.target.value = "";
    if (!files.length || disabled || busy || !ready) return;
    if (uploadController.current) return;
    for (const file of files) {
      const type = referenceType(file.name.split(".").at(-1).toLowerCase());
      if (!type || type.office && !officeEnabled) { onError?.({ code: "CREATION_REFERENCE_TYPE_UNSUPPORTED" }); return; }
      if (file.size > (type.office ? REFERENCE_OFFICE_BYTES : REFERENCE_TEXT_BYTES)) { onError?.({ code: "CREATION_REFERENCE_TOO_LARGE" }); return; }
    }
    const controller = new AbortController(); uploadController.current = controller;
    setBusy(true);
    try {
      for (const file of files.slice(0, 8 - items.length)) {
        const body = new FormData(); body.set("file", file);
        const result = await api(`/api/creation/sessions/${encodeURIComponent(sessionId)}/references`, { method: "POST", body, signal: controller.signal });
        if (controller.signal.aborted) return;
        setItems(current => [...current.filter(item => item.id !== result.item.id), result.item]);
        onChange(current => referenceAssetIds([...current, result.item.id]));
      }
      if (files.length > 8 - items.length) onError?.({ code: "CREATION_REFERENCE_COUNT_LIMIT" });
    } catch (error) { if (!controller.signal.aborted) { onError?.(error); setReload(value => value + 1); } }
    finally { if (!controller.signal.aborted) { setBusy(false); uploadController.current = null; } }
  }
  return <div className="cw-reference-files">
    {selected.length > 0 && <ul className="cw-reference-file-list">{selected.map((id, index) => {
      const item = byId.get(id);
      return <li key={id}><FileText size={13} /><span title={item?.name || id}>{item?.name || id}</span><small>{item?.fileType?.toUpperCase()}</small>{item && <a download href={`/api/creation/sessions/${encodeURIComponent(sessionId)}/references/${encodeURIComponent(id)}`} aria-label={text(`下载原文件 ${item.name}`, `Download original ${item.name}`)}><Download size={13} /></a>}<button type="button" disabled={disabled || busy} aria-label={text(`移除参考文件 ${index + 1}`, `Remove reference file ${index + 1}`)} onClick={() => onChange(selected.filter(value => value !== id))}><X size={13} /></button></li>;
    })}</ul>}
    {items.some(item => !selected.includes(item.id)) && <details><summary>{text("已上传的文档", "Uploaded documents")}</summary><ul className="cw-reference-file-list">{items.filter(item => !selected.includes(item.id)).map(item => <li key={item.id}><button type="button" disabled={disabled || busy} onClick={() => onChange(referenceAssetIds([...selected, item.id]))}>{text("引用", "Use")} {item.name}</button></li>)}</ul></details>}
    <input ref={input} aria-label={text("上传参考文档", "Upload reference documents")} type="file" multiple accept={`.txt,.md,.csv${officeEnabled ? ",.docx,.xlsx,.pptx" : ""}`} disabled={disabled || busy || !ready} hidden onChange={upload} />
    <button type="button" className="cw-add-reference" disabled={disabled || busy || !ready || items.length >= 8} onClick={() => input.current?.click()}>{busy ? <LoaderCircle size={14} className="animate-spin" /> : <Paperclip size={14} />}{text("添加文档", "Add documents")}{items.length > 0 && <span>{items.length}/8</span>}</button>
    {!ready && <button type="button" disabled={disabled} onClick={() => setReload(value => value + 1)}>{text("重新加载文档列表", "Reload documents")}</button>}
    <details className="cw-reference-help"><summary>{text("支持的格式与限制", "Supported formats and limits")}</summary><p className="cw-reference-file-hint">{officeEnabled ? text("TXT / MD / CSV（256 KiB），DOCX / XLSX / PPTX（4 MiB）。开始创作后读取文字与数据，原文件保留；图片和图表不作为可读内容。", "TXT / MD / CSV (256 KiB), DOCX / XLSX / PPTX (4 MiB). Text and data are read when creation starts; originals are retained. Images and charts are not interpreted.") : text("UTF-8 TXT / MD / CSV；单文件最多 256 KiB，每次引用合计最多 128 KiB。", "UTF-8 TXT / MD / CSV; up to 256 KiB per file and 128 KiB selected per request.")}</p></details>
  </div>;
}
