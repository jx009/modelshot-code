"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useTranslations, useLocale } from "next-intl";
import { Plus, Download, Search, Grid2X2, List, Images, LoaderCircle, RefreshCw, X, ArrowUpRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import DetailDrawer from "@/components/gallery/DetailDrawer";
import { downloadImage, downloadBlob } from "@/lib/image-download";

const filters = { all: "all", processing: "processing", completed: "ready", needs_review: "review", failed: "failed" };
const statusKey = status => filters[status] || "processing";

export default function GalleryPage() {
  const t = useTranslations("workspace");
  const locale = useLocale();
  const { status } = useSession();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [batch, setBatch] = useState("");
  const [view, setView] = useState("grid");
  const [selected, setSelected] = useState(new Set());
  const [detailId, setDetailId] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const fetchItems = useCallback(async (signal) => {
    const response = await fetch("/api/tryons", { signal });
    if (!response.ok) throw new Error("library");
    setItems(await response.json());
  }, []);
  useEffect(() => {
    if (status !== "authenticated") return;
    const controller = new AbortController();
    Promise.resolve().then(() => fetchItems(controller.signal)).catch(err => { if (err.name !== "AbortError") setError(t("loadError")); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [status, fetchItems, t]);
  const hasActive = items.some(item => !["completed", "needs_review", "failed"].includes(item.status));
  useEffect(() => {
    if (!hasActive || status !== "authenticated") return;
    const controller = new AbortController();
    let timeout;
    let failures = 0;
    const poll = async () => {
      try { await fetchItems(controller.signal); failures = 0; }
      catch { if (controller.signal.aborted) return; if (++failures >= 5) { setError(t("networkError")); return; } }
      if (!controller.signal.aborted) timeout = setTimeout(poll, 4000);
    };
    timeout = setTimeout(poll, 4000);
    return () => { controller.abort(); clearTimeout(timeout); };
  }, [hasActive, status, fetchItems, t]);

  const visible = useMemo(() => items.filter(item => (filter === "all" || (filter === "processing" ? ["processing", "queued"].includes(item.status) : item.status === filter)) && (!batch || item.batchJobId === batch || item.variantGroupId === batch) && (!search.trim() || [item.prompt, item.id, item.platformSpec].join(" ").toLowerCase().includes(search.trim().toLowerCase()))), [items, filter, search, batch]);
  const batches = [...new Set(items.map(i => i.batchJobId || i.variantGroupId).filter(Boolean))];
  const downloadable = visible.filter(i => i.resultImage);
  const exportItems = selected.size ? items.filter(i => selected.has(i.id) && i.resultImage) : downloadable;
  function toggle(id) { setSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  async function refresh() { setLoading(true); setError(""); try { await fetchItems(); } catch { setError(t("loadError")); } finally { setLoading(false); } }
  async function remove(id) {
    setDeleting(true);
    try { const res = await fetch(`/api/tryons?id=${encodeURIComponent(id)}`, { method: "DELETE" }); if (!res.ok) throw new Error("delete"); setItems(prev => prev.filter(i => i.id !== id)); setSelected(prev => { const next = new Set(prev); next.delete(id); return next; }); setDetailId(""); }
    catch { setError(t("deleteError")); } finally { setDeleting(false); }
  }
  async function exportImages() {
    if (!exportItems.length || exporting) return;
    setExporting(true); setError("");
    try {
      const { default: JSZip } = await import("jszip"); const zip = new JSZip(); let count = 0;
      for (const item of exportItems) { try { const res = await fetch(item.resultImage); if (!res.ok) continue; zip.file(`modelshot-${item.id}.png`, await res.blob()); count++; } catch { /* Continue exporting the other selected images. */ } }
      if (count) downloadBlob(await zip.generateAsync({ type: "blob" }), `modelshot-${new Date().toISOString().slice(0, 10)}.zip`);
      if (count !== exportItems.length) setError(t("partialExport"));
    } catch { setError(t("partialExport")); } finally { setExporting(false); }
  }
  const reset = () => { setFilter("all"); setSearch(""); setBatch(""); setSelected(new Set()); };
  const date = value => new Date(value).toLocaleDateString(locale, { month: "short", day: "numeric" });
  return <main className="library-page">
    <div className="library-heading"><div><div className="eyebrow">MODELSHOT / LIBRARY</div><h1>{t("gallery")}</h1><p>{t("count", { count: items.length })}</p></div><div className="flex gap-2"><button className="button" disabled={exporting || !exportItems.length} onClick={exportImages}>{exporting ? <LoaderCircle size={16} className="animate-spin" /> : <Download size={16} />}<span>{t(exporting ? "exporting" : selected.size ? "export" : "exportAll")}</span></button><Link className="button primary" href="/studio"><Plus size={17} />{t("new")}</Link></div></div>
    {status === "authenticated" && <>
      <div className="library-tools"><label className="search-field"><Search size={17} /><input type="search" aria-label={t("search")} placeholder={t("search")} value={search} onChange={e => setSearch(e.target.value)} /></label><div className="flex items-center gap-2"><select aria-label={t("allBatches")} value={batch} onChange={e => setBatch(e.target.value)}><option value="">{t("allBatches")}</option>{batches.map((b, i) => <option key={b} value={b}>{date(items.find(x => (x.batchJobId || x.variantGroupId) === b).createTime)} · #{i + 1}</option>)}</select><button className="icon-button" disabled={loading} title={t("retry")} aria-label={t("retry")} onClick={refresh}><RefreshCw size={16} className={loading ? "animate-spin" : ""} /></button><div className="mode-switch">{[["grid", Grid2X2], ["list", List]].map(([v, Icon]) => <button key={v} aria-label={t(v)} title={t(v)} aria-pressed={view === v} onClick={() => setView(v)}><Icon size={17} /></button>)}</div></div></div>
      <div className="library-filters">{Object.entries(filters).map(([key, label]) => <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{t(label)}<span>{key === "all" ? items.length : items.filter(i => key === "processing" ? ["processing", "queued"].includes(i.status) : i.status === key).length}</span></button>)}</div>
    </>}
    {error && <div className="inline-error flex items-center gap-3" role="alert"><span>{error}</span><button className="button compact" onClick={refresh}>{t("retry")}</button></div>}
    {status === "loading" || (status === "authenticated" && loading && !items.length) ? <div className="library-empty"><LoaderCircle size={26} className="animate-spin" /><p>{t("loading")}</p></div> : status !== "authenticated" ? <div className="library-empty"><Images size={36} strokeWidth={1.25} /><h2>{t("signInHint")}</h2><Link href="/login" className="button primary">{t("signIn")}<ArrowUpRight size={16} /></Link></div> : !visible.length ? <div className="library-empty"><Images size={38} strokeWidth={1.25} /><h2>{t(items.length ? "noMatch" : "emptyGallery")}</h2>{items.length ? <button className="button" onClick={reset}><X size={15} />{t("resetFilters")}</button> : <Link href="/studio" className="button primary"><Plus size={16} />{t("new")}</Link>}</div> : <>
      <div className="selection-toolbar"><label><input type="checkbox" checked={downloadable.length > 0 && downloadable.every(i => selected.has(i.id))} disabled={!downloadable.length} onChange={e => setSelected(e.target.checked ? new Set(downloadable.map(i => i.id)) : new Set())} />{t("selectAll")}</label>{selected.size > 0 && <><span>{t("selected", { count: selected.size })}</span><button className="icon-button" title={t("deselect")} aria-label={t("deselect")} onClick={() => setSelected(new Set())}><X size={14} /></button></>}</div>
      <div className={`shot-collection ${view === "list" ? "shot-list" : "shot-grid"}`}>{visible.map((item, index) => <article key={item.id} className={`shot-card ${selected.has(item.id) ? "selected" : ""}`}>
        <div className="shot-image"><button className="shot-open" aria-label={`${t("details")} ${index + 1}`} onClick={() => setDetailId(item.id)}><img src={item.resultImage || item.clothesImage} alt={`${t(item.resultImage ? "result" : "preview")} ${index + 1}`} loading="lazy" />{["processing", "queued"].includes(item.status) && <span className="shot-working"><LoaderCircle size={25} className="animate-spin" /></span>}</button><label className="shot-checkbox"><input type="checkbox" aria-label={`${t("select")} ${index + 1}`} disabled={!item.resultImage} checked={selected.has(item.id)} onChange={() => toggle(item.id)} /></label></div>
        <div className="shot-meta"><div><span className="shot-name">Shot {String(items.length - items.indexOf(item)).padStart(3, "0")}</span><span className={`shot-status ${statusKey(item.status)}`}>{t(statusKey(item.status))}</span></div><div><span>{item.platformSpec || "ModelShot"} · {item.aspectRatio}</span><time dateTime={item.createTime}>{date(item.createTime)}</time></div></div>
        <button className="icon-button shot-detail-button" title={t("details")} aria-label={t("details")} onClick={() => setDetailId(item.id)}><ArrowUpRight size={17} /></button>
      </article>)}</div>
    </>}
    {detailId && <DetailDrawer key={detailId} tryon={items.find(i => i.id === detailId)} onClose={() => setDetailId("")} onDownload={item => downloadImage(item.resultImage, `modelshot-${item.id}.png`).catch(() => setError(t("partialExport")))} onDelete={remove} deleting={deleting} />}
  </main>;
}
