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
export default function ExportDialog({ artifactId, userId, kind = "slides", sourceSchemaVersion = 1, onFlush, onClose, zh }) {
  const journalKey = `creation-export:${userId}:${artifactId}`;
  const [listing, setListing] = useState(null), [error, setError] = useState(null), [busy, setBusy] = useState(false), [pending, setPending] = useState(() => readJournal(journalKey));
  const [epoch, setEpoch] = useState(0);
  const formats = exportFormatsForKind(kind);
  const [format, setFormat] = useState(() => formats[0]);
  const life = useRef(null), gate = useRef(null), request = useRef(pending);
  const text = (cn, en) => zh ? cn : en;
  const enabled = value => listing?.formats ? listing.formats.some(item => item.format === value && item.enabled) : value === "pptx" && listing?.enabled;
  const title = kind === "web" ? text("导出网页", "Export website") : kind === "poster" ? text("导出海报", "Export poster") : kind === "document" ? text("导出文档", "Export document") : kind === "sheet" ? text("导出工作簿", "Export workbook") : text("导出演示文稿", "Export presentation");
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
      {(pending?.format || format) === "markdown" ? <>
        <p>{text("下载包含 document.md 和图片目录的 ZIP，解压后一起使用。保留正文、标题、列表、表格、链接和图片；表格与部分文字格式使用内嵌 HTML，需要阅读器支持。", "Download a ZIP containing document.md and its images. Extract and keep them together. Text, headings, lists, tables, links and images are retained; tables and some text formatting require a reader that supports inline HTML.")}</p>
        <p>{text("字体、颜色、对齐、分页、页眉页脚、页码和编辑锁定不保留。导出固定保存版本，原稿不变；高级文档中尚未适配的内容会使导出停止。", "Fonts, colors, alignment, pagination, headers, footers, page numbers and editing locks are not retained. Export uses a fixed saved version and keeps the original. Unsupported advanced document content stops the export.")}</p>
      </> : (pending?.format || format) === "pdf" && kind === "document" ? <>
        <p>{text("按已保存版本生成 PDF，支持正文、标题、列表、表格、图片、页眉页脚和页码。后台自动分页，最多 100 页；生成期间可以离开页面。", "Export the saved document as PDF with paragraphs, headings, lists, tables, images, headers, footers and page numbers. Pagination runs in the background, up to 100 pages; you can leave while it runs.")}</p>
        <p>{text("采用服务端字体重新排版，换行和分页可能与编辑器不同；链接保留显示文字。暂不支持的复杂版式或超高表格行会停止导出，不会静默删减内容。可编辑原稿保留。", "Server fonts can change line and page breaks. Links retain their display text. Unsupported complex layouts or oversized table rows stop export without silently removing content. The editable original is preserved.")}</p>
      </> : (pending?.format || format) === "pdf" ? <>
        <p>{text("PDF 按已保存版本导出，保留文字、形状和图片的排版。幻灯片按当前顺序输出，隐藏页和演讲备注不包含在内；海报保留完整画板。", "PDF exports the saved layout of text, shapes and images. Slides follow their current order; hidden slides and speaker notes are omitted. Posters keep the full board.")}</p>
        <p>{text("支持不同页面尺寸，最多 100 页；单页最多 800 万像素，全文约 50 万字符以内。字体和换行可能与浏览器不同，部分中文字复制或搜索时可能出现异体码差异。可编辑原稿仍保留，关闭页面后可回来下载。", "Mixed page sizes are supported, up to 100 pages, 8 million pixels per page and approximately 500,000 characters. Fonts and line breaks may differ from the browser; some Chinese characters may use variant codes when copied or searched. The editable original stays in the project; downloads remain available after you leave.")}</p>
      </> : kind === "web" ? <>
        <p>{text("ZIP 保留已保存版本的 HTML、CSS、脚本与图片目录。解压后可部署到静态网站服务，入口页面由作品中的入口路径决定。", "ZIP preserves the saved revision’s HTML, CSS, scripts and image directories. Extract it to a static host and use the artwork’s entry path.")}</p>
        <p>{text("导出保留脚本源码，部署后的行为可能与当前静态预览不同。导出不会自动发布网站；单个压缩包上限 64 MiB，图片按目标扩展名转换。", "Script source is included, so behavior after deployment may differ from the static preview. Export does not publish a website. Archives are limited to 64 MiB; images are converted to match their file extensions.")}</p>
      </> : kind === "poster" ? <>
        {(pending?.format || format) === "svg" ? <>
          <p>{text("SVG 保留文字和基础形状的矢量内容，图片会内嵌为位图。文字未转曲、字体未嵌入，在其他设备打开时字形和间距可能变化。", "SVG keeps text and basic shapes as vectors, with images embedded as bitmaps. Text is not outlined and fonts are not embedded, so glyphs and spacing may change on other devices.")}</p>
          <p>{text("换行由服务端 Noto 字体测量。隐藏对象不导出，可见素材合计最多 1600 万像素，文件上限 64 MiB。导出固定保存版本，关闭页面后可回来下载。", "Line breaks are measured using server Noto fonts. Invisible objects are omitted. Visible source images are limited to 16 million pixels in total, and the file to 64 MiB. Exports use a fixed saved version and remain available after you leave.")}</p>
        </> : <>
        <p>{text("按画板原尺寸导出，最多 800 万像素。PNG 保留画板透明度；JPEG 使用白色底色、90% 质量。导出文件为图片，可编辑原稿仍保留在项目中。", "Export at the original board size, up to 8 million pixels. PNG preserves board transparency; JPEG uses a white background at 90% quality. The editable original stays in the project.")}</p>
        <p>{text("服务端使用 Noto 字体，字形和换行可能与浏览器不同。可见素材合计最多 1600 万像素；隐藏对象不导出。导出固定保存版本，关闭页面后可回来下载。", "The server uses Noto fonts; glyphs and line breaks may differ from your browser. Visible source images are limited to 16 million pixels in total; invisible objects are omitted. Exports use a fixed saved version and remain available after you leave.")}</p>
        </>}
      </> : kind === "document" && sourceSchemaVersion === 2 ? <>
        <p>{text("DOCX 保留正文格式、列表、基础表格、行内图片、链接和页眉页脚，页码在 Word/WPS 中更新。导出绑定保存版本，关闭页面后可回来下载。", "DOCX keeps text formatting, lists, basic tables, inline images, links, headers and footers. Word/WPS updates page fields. Exports use a fixed saved version and remain available after you leave.")}</p>
        <p>{text("字体未嵌入，分页和排版可能有差异。批注、浮动图片、合并表格、命名样式等尚未适配的内容会使导出停止，原稿保留。", "Fonts are not embedded; pagination and layout may differ. Comments, floating images, merged table cells, named styles and other unsupported content stop the export; the original is retained.")}</p>
      </> : kind === "document" ? <>
        <p>{text("DOCX 保留可编辑正文、标题、列表、表格、图片和链接，支持页眉、页脚和页码。导出使用固定保存版本，关闭页面后可回来下载。", "DOCX keeps editable text, headings, lists, tables, images and links, with headers, footers and page numbers. Exports use a fixed saved version and remain available after you leave.")}</p>
        <p>{text("字体未嵌入，Word/WPS 中的分页和排版可能不同。超过页面可用区域的图片会等比缩小，项目内的块锁定不会变成 Word 编辑保护。", "Fonts are not embedded; pagination and layout may differ in Word/WPS. Oversized images are scaled to fit the page. Block locks do not become Word editing protection.")}</p>
      </> : kind === "sheet" && sourceSchemaVersion === 2 ? <>
        <p>{text("XLSX 保留多工作表、普通单元格、基础公式、单元格样式、行列尺寸、合并区域和冻结视图。导出绑定保存版本，关闭页面后可回来下载。", "XLSX keeps worksheets, plain cells, basic formulas, cell styles, row and column sizes, merged ranges and frozen panes. Exports use a fixed saved version and remain available after you leave.")}</p>
        <p>{text("公式在 Excel/WPS 中重新计算，字体和列宽可能有差异。富文本、保护规则、图表及其他尚不支持的内容会使导出停止，原稿保留。", "Formulas recalculate in Excel/WPS; fonts and column widths may differ. Rich text, protection rules, charts and other unsupported content stop the export; the original is retained.")}</p>
      </> : kind === "sheet" ? <>
        <p>{text("XLSX 保留多工作表、单元格、基础公式和冻结视图。公式会在 Excel/WPS 中重新计算；外部链接、宏和不支持的高级对象不会被带入导出文件。", "XLSX keeps worksheets, cells, basic formulas and frozen panes. Formulas recalculate in Excel/WPS; external links, macros and unsupported advanced objects are not included.")}</p>
        <p>{text("导出固定保存版本，关闭页面后仍可下载。当前工作簿以结构化单元格为权威源。", "The export uses a fixed saved revision and remains downloadable after you leave. The structured workbook is the source of truth.")}</p>
      </> : <>
      <p>{text("PPTX 保留可编辑文字、形状、图片和演讲备注。字体未嵌入，PowerPoint/WPS 中的换行和排版可能不同。隐藏页面会保留并标记为隐藏，隐藏对象不导出。", "PPTX keeps editable text, shapes, images and speaker notes. Fonts are not embedded; line breaks and layout may differ in PowerPoint/WPS. Hidden slides are retained as hidden; invisible objects are omitted.")}</p>
      <p>{text("导出固定保存版本，完成后可随时回来下载。各页需同尺寸，宽高为 96–5376 像素。", "Exports use a fixed saved version and can be downloaded later. All slides must share dimensions between 96 and 5376 pixels.")}</p>
      </>}
      {formats.length > 1 && <label>{text("导出格式", "Export format")} <select aria-label={text("导出格式", "Export format")} value={pending?.format || format} disabled={busy || Boolean(pending)} onChange={event => setFormat(event.target.value)}>{formats.map(value => <option key={value} value={value}>{value.toUpperCase()}</option>)}</select></label>}
      <button disabled={busy || !pending && !enabled(format)} onClick={() => submit()}><Download size={16} />{text(pending ? "恢复提交" : busy ? "正在提交…" : `保存并导出 ${format.toUpperCase()}`, pending ? "Recover submission" : busy ? "Submitting…" : `Save and export ${format.toUpperCase()}`)}</button>
      {listing && !enabled(format) && <p>{text("当前暂不接受此格式的新导出，已完成的文件仍可下载。", "New exports in this format are currently unavailable. Completed files can still be downloaded.")}</p>}
      {error && <p role="alert">{creationError(error, zh)} <button disabled={busy} onClick={() => { setError(null); setEpoch(value => value + 1); }}>{text("刷新", "Refresh")}</button></p>}
      {!listing && !error && <p role="status">{text("正在读取导出记录…", "Loading exports…")}</p>}
      <ul>{listing?.items.map(row => <li key={row.id}><div><strong>{row.format?.toUpperCase()} · V{row.revision}</strong><span role={active(row) ? "status" : undefined}>{labels[row.status]?.[zh ? 0 : 1]}</span>{row.errorCode && <p>{creationError({ code: row.errorCode }, zh)}</p>}</div>
        {row.downloadUrl && <a href={row.downloadUrl} download>{text("下载", "Download")}</a>}
        {active(row) && <button disabled={busy} onClick={() => cancel(row.id)}>{text("取消", "Cancel")}</button>}
        {["failed", "cancelled"].includes(row.status) && <button disabled={busy || Boolean(pending) || !exportFormat(row.format) || !(row.canRetry ?? enabled(row.format))} onClick={() => submit(row)}>{text("重试此版本", "Retry this version")}</button>}
      </li>)}</ul>
      {listing && !listing.items.length && <p>{text("还没有导出记录。", "No exports yet.")}</p>}
      {listing?.items.length === 12 && <p>{text("显示最近 12 次导出。", "Showing the latest 12 exports.")}</p>}
    </div>
  </Modal>;
}
