"use client";

import { useEffect, useRef, useState } from "react";
import { Download, X } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { api, requestKey } from "@/lib/client-api";
import { creationError } from "./creation-errors";
import { exportFormat, exportFormatsForKind, requestExportSchema } from "@/lib/creation/contracts/exports";

const active = row => ["queued", "running"].includes(row.status);
function readJournal(key) {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || "null");
    const parsed = requestExportSchema.safeParse(value);
    if (parsed.success) return parsed.data;
  } catch { /* No browser storage or malformed recovery record. */ }
  return null;
}
export default function ExportDialog({ artifactId, userId, kind = "slides", onFlush, onClose, zh }) {
  const journalKey = `creation-export:${userId}:${artifactId}`;
  const [listing, setListing] = useState(null), [error, setError] = useState(null), [busy, setBusy] = useState(false), [pending, setPending] = useState(() => readJournal(journalKey));
  const [epoch, setEpoch] = useState(0);
  const formats = exportFormatsForKind(kind);
  const [format, setFormat] = useState(() => formats[0]);
  const life = useRef(null), gate = useRef(null), request = useRef(pending);
  const text = (cn, en) => zh ? cn : en;
  const enabled = value => listing?.formats ? listing.formats.some(item => item.format === value && item.enabled) : value === "pptx" && listing?.enabled;
  const title = kind === "poster" ? text("导出海报", "Export poster") : text("导出演示文稿", "Export presentation");
  const labels = { queued: ["排队中", "Queued"], running: ["正在导出", "Exporting"], succeeded: ["可下载", "Ready"], failed: ["导出失败", "Failed"], cancelled: ["已取消", "Cancelled"] };
  useEffect(() => {
    const abort = new AbortController(); life.current = abort;
    // Activity preserves React state while disposing effects. The old request
    // may still resolve, but only this lifetime can unlock/update the dialog.
    gate.current = null;
    // Reconcile retained UI after effect setup; do not synchronously cascade
    // a render during commit or clear an action started in the new lifetime.
    queueMicrotask(() => { if (!abort.signal.aborted && gate.current === null) setBusy(false); });
    return () => abort.abort();
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    let timer, loading = false;
    const load = async () => {
      clearTimeout(timer);
      if (abort.signal.aborted || document.hidden || loading) return;
      loading = true;
      try {
        const value = await api(`/api/creation/artifacts/${encodeURIComponent(artifactId)}/exports`, { signal: abort.signal });
        if (abort.signal.aborted) return;
        setListing(value);
        if (value.items.some(active)) timer = setTimeout(load, 5000);
      } catch (failure) { if (!abort.signal.aborted) setError(failure); }
      finally { loading = false; }
    };
    const visibility = () => { clearTimeout(timer); if (!document.hidden) void load(); };
    void load(); document.addEventListener("visibilitychange", visibility);
    return () => { abort.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", visibility); };
  }, [artifactId, epoch]);
  async function submit(retry) {
    if (gate.current) return;
    const token = {}; gate.current = token; setBusy(true); setError(null);
    const signal = life.current.signal;
    try {
      let body = request.current;
      if (!body) {
        // Retry uses the failed task's fixed version. New exports explicitly
        // flush all pending canvas text and operations before choosing a version.
        const revision = retry ? retry.revision : (await onFlush()).revision;
        if (signal.aborted) return;
        body = { revision, format: retry ? retry.format : format, ...(retry ? { retryKey: requestKey(), retryAttempt: retry.attempt } : {}) };
        sessionStorage.setItem(journalKey, JSON.stringify(body)); request.current = body; setPending(body);
      }
      await api(`/api/creation/artifacts/${encodeURIComponent(artifactId)}/exports`, { method: "POST", body, signal });
      if (signal.aborted) return;
      sessionStorage.removeItem(journalKey); request.current = null; setPending(null); setEpoch(value => value + 1);
    } catch (failure) {
      if (!signal.aborted) {
        if (failure.status >= 400 && failure.status < 500 && ![408, 429].includes(failure.status)) { sessionStorage.removeItem(journalKey); request.current = null; setPending(null); }
        setError(failure);
      }
    } finally { if (gate.current === token) { gate.current = null; if (!signal.aborted) setBusy(false); } }
  }
  async function cancel(id) {
    if (gate.current) return;
    const token = {}, signal = life.current.signal; gate.current = token; setBusy(true); setError(null);
    try { await api(`/api/creation/exports/${encodeURIComponent(id)}`, { method: "DELETE", signal }); if (!signal.aborted) setEpoch(value => value + 1); }
    catch (failure) { if (!signal.aborted) setError(failure); }
    finally { if (gate.current === token) { gate.current = null; if (!signal.aborted) setBusy(false); } }
  }
  return <Modal className="cw-export-dialog" label={title} onClose={onClose}>
    <header><strong>{title}</strong><button onClick={onClose} aria-label={text("关闭导出", "Close export")}><X size={18} /></button></header>
    <div className="cw-export-content">
      {(pending?.format || format) === "pdf" ? <>
        <p>{text("PDF 按已保存版本导出，保留文字、形状和图片的排版。幻灯片按当前顺序输出，隐藏页和演讲备注不包含在内；海报保留完整画板。", "PDF exports the saved layout of text, shapes and images. Slides follow their current order; hidden slides and speaker notes are omitted. Posters keep the full board.")}</p>
        <p>{text("支持不同页面尺寸，最多 100 页；单页最多 800 万像素，全文约 50 万字符以内。字体和换行可能与浏览器不同，部分中文字复制或搜索时可能出现异体码差异。可编辑原稿仍保留，关闭页面后可回来下载。", "Mixed page sizes are supported, up to 100 pages, 8 million pixels per page and approximately 500,000 characters. Fonts and line breaks may differ from the browser; some Chinese characters may use variant codes when copied or searched. The editable original stays in the project; downloads remain available after you leave.")}</p>
      </> : kind === "poster" ? <>
        {(pending?.format || format) === "svg" ? <>
          <p>{text("SVG 保留文字和基础形状的矢量内容，图片会内嵌为位图。文字未转曲、字体未嵌入，在其他设备打开时字形和间距可能变化。", "SVG keeps text and basic shapes as vectors, with images embedded as bitmaps. Text is not outlined and fonts are not embedded, so glyphs and spacing may change on other devices.")}</p>
          <p>{text("换行由服务端 Noto 字体测量。隐藏对象不导出，可见素材合计最多 1600 万像素，文件上限 64 MiB。导出固定保存版本，关闭页面后可回来下载。", "Line breaks are measured using server Noto fonts. Invisible objects are omitted. Visible source images are limited to 16 million pixels in total, and the file to 64 MiB. Exports use a fixed saved version and remain available after you leave.")}</p>
        </> : <>
        <p>{text("按画板原尺寸导出，最多 800 万像素。PNG 保留画板透明度；JPEG 使用白色底色、90% 质量。导出文件为图片，可编辑原稿仍保留在项目中。", "Export at the original board size, up to 8 million pixels. PNG preserves board transparency; JPEG uses a white background at 90% quality. The editable original stays in the project.")}</p>
        <p>{text("服务端使用 Noto 字体，字形和换行可能与浏览器不同。可见素材合计最多 1600 万像素；隐藏对象不导出。导出固定保存版本，关闭页面后可回来下载。", "The server uses Noto fonts; glyphs and line breaks may differ from your browser. Visible source images are limited to 16 million pixels in total; invisible objects are omitted. Exports use a fixed saved version and remain available after you leave.")}</p>
        </>}
      </> : <>
      <p>{text("PPTX 保留可编辑文字、形状、图片和演讲备注。字体未嵌入，PowerPoint/WPS 中的换行和排版可能不同。隐藏页面会保留并标记为隐藏，隐藏对象不导出。", "PPTX keeps editable text, shapes, images and speaker notes. Fonts are not embedded; line breaks and layout may differ in PowerPoint/WPS. Hidden slides are retained as hidden; invisible objects are omitted.")}</p>
      <p>{text("导出固定保存版本，完成后可随时回来下载。各页需同尺寸，宽高为 96–5376 像素。", "Exports use a fixed saved version and can be downloaded later. All slides must share dimensions between 96 and 5376 pixels.")}</p>
      </>}
      {formats.length > 1 && <label>{text("导出格式", "Export format")} <select aria-label={text("导出格式", "Export format")} value={pending?.format || format} disabled={busy || Boolean(pending)} onChange={event => setFormat(event.target.value)}>{formats.map(value => <option key={value} value={value}>{value.toUpperCase()}</option>)}</select></label>}
      <button disabled={busy || !pending && !enabled(format)} onClick={() => submit()}><Download size={16} />{text(pending ? "恢复提交" : busy ? "正在提交…" : `保存并导出 ${format.toUpperCase()}`, pending ? "Recover submission" : busy ? "Submitting…" : `Save and export ${format.toUpperCase()}`)}</button>
      {listing && !enabled(format) && <p>{text("当前暂不接受此格式的新导出，已完成的文件仍可下载。", "New exports in this format are currently unavailable. Completed files can still be downloaded.")}</p>}
      {error && <p role="alert">{creationError(error, zh)} <button disabled={busy} onClick={() => { setError(null); setEpoch(value => value + 1); }}>{text("刷新", "Refresh")}</button></p>}
      {!listing && !error && <p role="status">{text("正在读取导出记录…", "Loading exports…")}</p>}
      <ul>{listing?.items.map(row => <li key={row.id}><div><strong>{row.format?.toUpperCase()} · V{row.revision}</strong><span role={active(row) ? "status" : undefined}>{row.status === "queued" && row.errorCode
          ? (zh ? `上次转换失败，正在自动重试（第 ${(row.attempt || 0) + 1} 次）` : `Last attempt failed; retrying automatically (attempt ${(row.attempt || 0) + 1})`)
          : labels[row.status]?.[zh ? 0 : 1]}</span>{row.errorCode && row.status !== "queued" && <p>{creationError({ code: row.errorCode }, zh)}</p>}</div>
        {row.downloadUrl && <a href={row.downloadUrl} download>{text("下载", "Download")}</a>}
        {active(row) && <button disabled={busy} onClick={() => cancel(row.id)}>{text("取消", "Cancel")}</button>}
        {["failed", "cancelled"].includes(row.status) && <button disabled={busy || Boolean(pending) || !exportFormat(row.format) || !(row.canRetry ?? enabled(row.format))} onClick={() => submit(row)}>{text("重试此版本", "Retry this version")}</button>}
      </li>)}</ul>
      {listing && !listing.items.length && <p>{text("还没有导出记录。", "No exports yet.")}</p>}
      {listing?.items.length === 12 && <p>{text("显示最近 12 次导出。", "Showing the latest 12 exports.")}</p>}
    </div>
  </Modal>;
}
