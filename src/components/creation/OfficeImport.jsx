"use client";

import { useEffect, useRef, useState } from "react";
import { api, requestKey } from "@/lib/client-api";
import { creationError } from "./creation-errors";

const active = item => ["queued", "running"].includes(item.status);
const extension = kind => ({ document: ".docx", sheet: ".xlsx", slides: ".pptx" })[kind] || "";
export default function OfficeImport({ projectId, kind, zh, onSelect, onImported }) {
  const [state, setState] = useState({ items: [], enabled: false }), [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const life = useRef(null), upload = useRef(null), callbacks = useRef({ onImported, onSelect });
  callbacks.current = { onImported, onSelect };
  const endpoint = "/api/creation/projects/" + encodeURIComponent(projectId) + "/imports";
  useEffect(() => {
    const controller = new AbortController(); life.current = controller;
    let timer, known = new Map(), first = true, polling = false, again = false;
    async function poll() {
      if (polling) { again = true; return; }
      polling = true;
      try {
        const result = await api(endpoint, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setState(result);
        const completed = !first && result.items.some(item => item.status === "succeeded" && known.get(item.id) !== "succeeded");
        known = new Map(result.items.map(item => [item.id, item.status])); first = false;
        if (completed) await callbacks.current.onImported?.();
        if (result.items.some(active)) timer = setTimeout(poll, document.visibilityState === "hidden" ? 10000 : 2500);
      } catch (failure) {
        if (!controller.signal.aborted) { setError(failure); timer = setTimeout(poll, 10000); }
      } finally {
        polling = false;
        if (again && !controller.signal.aborted) { again = false; clearTimeout(timer); timer = setTimeout(poll, 0); }
      }
    }
    const refresh = () => { clearTimeout(timer); void poll(); };
    life.current.refresh = refresh;
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [endpoint]);
  async function submit(file) {
    if (busy || !file) return;
    if (file.size > 4 * 1024 * 1024) { setError({ code: "OFFICE_SOURCE_LIMIT" }); return; }
    const ext = extension(kind);
    if (!file.name.toLowerCase().endsWith(ext)) { setError({ code: "OFFICE_FORMAT_UNSUPPORTED" }); return; }
    if (upload.current?.file !== file) upload.current = { file, key: requestKey() };
    setBusy(true); setError(null);
    const signal = life.current.signal;
    try {
      const body = new FormData(); body.set("file", file);
      const item = await api(endpoint, { method: "POST", body, key: upload.current.key, signal });
      if (signal.aborted) return;
      upload.current = null;
      setState(current => ({ ...current, items: [item, ...current.items.filter(old => old.id !== item.id)].slice(0, 12) }));
      life.current.refresh();
    } catch (failure) { if (!signal.aborted) setError(failure); }
    finally { if (!signal.aborted) setBusy(false); }
  }
  async function cancel(id) {
    try { await api("/api/creation/imports/" + encodeURIComponent(id), { method: "DELETE", signal: life.current.signal }); life.current.refresh(); }
    catch (failure) { if (!life.current.signal.aborted) setError(failure); }
  }
  return <details className="cw-office-import"><summary>{zh ? "导入 Office 文件" : "Import Office"}</summary>
    <label>{zh ? "原件保留 · 最大 4 MiB" : "Original retained · up to 4 MiB"}<input type="file" aria-label={zh ? "导入 Office 文件" : "Import Office file"} accept={extension(kind)} disabled={busy || !state.enabled} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void submit(file); }} /></label>
    {!state.enabled && <small>{zh ? "导入服务尚未就绪，已有文件仍可打开。" : "Import service is unavailable. Existing files remain accessible."}</small>}
    {busy && <p role="status">{zh ? "正在上传…" : "Uploading…"}</p>}
    {error && <div role="alert">{creationError(error, zh)}<button disabled={busy} onClick={() => upload.current ? submit(upload.current.file) : life.current.refresh()}>{zh ? "重试" : "Retry"}</button></div>}
    {state.items.map(item => <div key={item.id}><span title={item.name}>{item.name}</span><small>{({ queued: ["排队", "Queued"], running: ["读取中", "Reading"], succeeded: ["已导入", "Imported"], failed: ["失败", "Failed"], cancelled: ["已取消", "Cancelled"] })[item.status]?.[zh ? 0 : 1]}</small>
      {item.artifactId && <button onClick={() => callbacks.current.onSelect(item.artifactId)}>{zh ? "打开" : "Open"}</button>}
      {active(item) && <button onClick={() => cancel(item.id)}>{zh ? "取消" : "Cancel"}</button>}
      <a href={item.sourceUrl} download>{zh ? "原件" : "Original"}</a>
      {item.errorCode && <p>{creationError({ code: item.errorCode }, zh)}</p>}
      {item.warnings.length > 0 && <details><summary>{zh ? "兼容提示" : "Compatibility"} ({item.warnings.length})</summary><p>{kind === "slides" ? zh ? "原始 PPTX 已保留。未转换的对象只在原件中存在，不会出现在可编辑副本里。" : "The original PPTX is retained. Unsupported objects remain only in the original and are absent from the editable copy." : zh ? "复杂对象保留在原件中；受保护范围不能修改。" : "Complex objects are retained in the original; protected ranges cannot be edited."}</p><ul>{item.warnings.map(w => <li key={w}>{w}</li>)}</ul></details>}
    </div>)}
  </details>;
}
