"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useTranslations, useLocale } from "next-intl";
import { Plus, Download, Search, Grid2X2, List, Images, LoaderCircle, RefreshCw, X, ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import DetailDrawer from "@/components/gallery/DetailDrawer";
import ExportTray from "@/components/gallery/ExportTray";
import AssetImage from "@/components/ui/AssetImage";
import { downloadImage } from "@/lib/image-download";
import { api, terminalStatus } from "@/lib/client-api";
import { useRemoteResource } from "@/hooks/useRemoteResource";

const filters = { all: "all", active: "processing", succeeded: "ready", needs_review: "review", failed: "failed", cancelled: "cancel" };

export default function GalleryPage() {
  const t = useTranslations("workspace");
  const f = useTranslations("flow");
  const locale = useLocale();
  const { status } = useSession();
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [batch, setBatch] = useState("");
  const [project, setProject] = useState("");
  const [view, setView] = useState("grid");
  const [selected, setSelected] = useState(new Set());
  const [detailId, setDetailId] = useState("");
  const [cursors, setCursors] = useState([null]);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportMode, setExportMode] = useState("delivery");
  const [exportRevision, setExportRevision] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const params = new URLSearchParams({ limit: "24", status: filter, q: query, batchId: batch, projectId: project, cursor: cursors.at(-1) || "" });
  const resource = useRemoteResource(status === "authenticated" ? `/api/tryons?${params}` : null);
  const groups = useRemoteResource(status === "authenticated" ? "/api/projects" : null);
  const batches = useRemoteResource(status === "authenticated" ? "/api/batch" : null);
  const detail = useRemoteResource(detailId ? `/api/tryons?id=${encodeURIComponent(detailId)}` : null);
  const detailActive = detail.data && (!terminalStatus(detail.data.status) || detail.data.qaStatus === "pending" || detail.data.exportStatus === "pending");
  useEffect(() => { if (!detailActive) return; const timer = setInterval(detail.reload, 5000); return () => clearInterval(timer); }, [detailActive, detail.reload]);
  const items = resource.data?.items || [];
  const active = items.some(row => !terminalStatus(row.status) || row.qaStatus === "pending" || row.exportStatus === "pending");
  useEffect(() => { if (!active) return; const timer = setInterval(resource.reload, 5000); return () => clearInterval(timer); }, [active, resource.reload]);
  useEffect(() => { Promise.resolve().then(() => { const id = new URLSearchParams(window.location.search).get("id"); if (id) setDetailId(id); }); }, []);
  const downloadable = items.filter(row => row.status === "succeeded");
  const exportIds = selected.size ? [...selected] : downloadable.map(row => row.id);
  const statusKey = row => row.status === "succeeded" ? row.qaStatus === "needs_review" ? "review" : "ready" : row.status === "failed" ? "failed" : "processing";
  const fail = err => setError(f.has(`errors.${err.code}`) ? f(`errors.${err.code}`) : f("requestFailed"));
  function changeFilter(setter, value) { setter(value); setCursors([null]); }
  function toggle(id) { setSelected(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  async function remove(id) {
    setDeleting(true);
    try { await api(`/api/tryons?id=${encodeURIComponent(id)}`, { method: "DELETE" }); setDetailId(""); setSelected(previous => { const next = new Set(previous); next.delete(id); return next; }); resource.reload(); } catch (err) { fail(err); } finally { setDeleting(false); }
  }
  async function exportImages() {
    if (exporting || !exportIds.length) return;
    setExporting(true); setError("");
    try { await api("/api/exports", { method: "POST", key: crypto.randomUUID(), body: { outputIds: exportIds, mode: exportMode } }); setExportRevision(value => value + 1); } catch (err) { fail(err); } finally { setExporting(false); }
  }
  return <main className="library-page">
    <div className="library-heading"><div><h1>{t("gallery")}</h1><p>{t("count", { count: resource.data?.total || 0 })}</p></div><div className="flex flex-wrap gap-2"><select className="workflow-select" aria-label={f("delivery")} value={exportMode} onChange={e => setExportMode(e.target.value)}><option value="delivery">{f("delivery")}</option><option value="original">{f("original")}</option></select><button className="button" title={f("createExport")} aria-label={f("createExport")} disabled={exporting || !exportIds.length} onClick={exportImages}>{exporting ? <LoaderCircle size={16} className="animate-spin" /> : <Download size={16} />}<span>{selected.size ? f("exportSelection", { count: selected.size }) : f("exportPage")}</span></button><Link className="button primary" href="/studio"><Plus size={17} />{t("new")}</Link></div></div>
    {status === "authenticated" && <><div className="library-tools"><form className="search-field" onSubmit={e => { e.preventDefault(); changeFilter(setQuery, search); }}><Search size={17} /><input type="search" aria-label={t("search")} placeholder={`${f("sku")} / ${t("search")}`} value={search} onChange={e => setSearch(e.target.value)} /><button className="icon-button" aria-label={t("search")} title={t("search")}><ArrowUpRight size={15} /></button></form><div className="flex items-center gap-2"><select aria-label={f("project")} value={project} onChange={e => changeFilter(setProject, e.target.value)}><option value="">{f("allProjects")}</option>{groups.data?.map(row => <option value={row.id} key={row.id}>{row.name}</option>)}</select><select aria-label={t("allBatches")} value={batch} onChange={e => changeFilter(setBatch, e.target.value)}><option value="">{t("allBatches")}</option>{batches.data?.map(row => <option key={row.id} value={row.id}>{row.name || row.id.slice(-8)}</option>)}</select><button className="icon-button" disabled={resource.loading} title={f("refresh")} aria-label={f("refresh")} onClick={resource.reload}><RefreshCw size={16} /></button><div className="mode-switch">{[["grid", Grid2X2], ["list", List]].map(([value, Icon]) => <button key={value} aria-label={t(value)} title={t(value)} aria-pressed={view === value} onClick={() => setView(value)}><Icon size={17} /></button>)}</div></div></div><div className="library-filters">{Object.entries(filters).map(([key, label]) => <button key={key} aria-pressed={filter === key} onClick={() => changeFilter(setFilter, key)}>{key === "cancelled" ? f("cancelled") : t(label)}</button>)}</div></>}
    {(error || resource.error || detail.error) && <div className="inline-error" role="alert">{error || f("loadError")}<button className="button compact" onClick={() => { setError(""); resource.reload(); detail.reload(); }}>{f("retry")}</button></div>}
    {status === "loading" || resource.loading ? <div className="library-empty"><LoaderCircle size={26} className="animate-spin" />{t("loading")}</div> : status !== "authenticated" ? <div className="library-empty"><Images size={36} /><h2>{t("signInHint")}</h2><Link href="/login" className="button primary">{t("signIn")}</Link></div> : !items.length ? <div className="library-empty"><Images size={36} /><h2>{t("emptyGallery")}</h2><Link href="/studio" className="button primary"><Plus size={16} />{t("new")}</Link></div> : <>
      <div className="selection-toolbar"><label><input type="checkbox" checked={downloadable.length > 0 && downloadable.every(row => selected.has(row.id))} disabled={!downloadable.length} onChange={event => { const checked = event.target.checked; setSelected(previous => { const next = new Set(previous); for (const row of downloadable) { if (checked) next.add(row.id); else next.delete(row.id); } return next; }); }} />{f("currentPage")}</label>{selected.size > 0 && <><span>{t("selected", { count: selected.size })}</span><button className="icon-button" title={f("clearSelection")} aria-label={f("clearSelection")} onClick={() => setSelected(new Set())}><X size={15} /></button></>}</div>
      <div className={`shot-collection ${view === "list" ? "shot-list" : "shot-grid"}`}>{items.map((row, index) => <article className={`shot-card ${selected.has(row.id) ? "selected" : ""}`} key={row.id}><div className="shot-image"><button className="shot-open" aria-label={`${t("details")} ${index + 1}`} onClick={() => setDetailId(row.id)}><AssetImage src={row.resultImage || row.clothesImage} alt={row.sku || t(row.resultImage ? "result" : "preview")} loading="lazy" />{!terminalStatus(row.status) && <span className="shot-working"><LoaderCircle size={24} className="animate-spin" /></span>}</button><label className="shot-checkbox"><input type="checkbox" aria-label={`${t("select")} ${index + 1}`} disabled={row.status !== "succeeded"} checked={selected.has(row.id)} onChange={() => toggle(row.id)} /></label></div><div className="shot-meta"><div><span className="shot-name">{row.sku || row.id.slice(-8)}</span><span className={`shot-status ${statusKey(row)}`}>{row.status === "cancelled" ? f("cancelled") : t(statusKey(row))}</span></div><div><span>{row.aspectRatio}</span><time dateTime={row.createTime}>{new Date(row.createTime).toLocaleDateString(locale)}</time></div></div><button className="icon-button shot-detail-button" title={t("details")} aria-label={t("details")} onClick={() => setDetailId(row.id)}><ArrowUpRight size={17} /></button></article>)}</div>
    </>}
    {status === "authenticated" && <><div className="pagination"><button className="icon-button" title={f("previous")} aria-label={f("previous")} disabled={cursors.length === 1 || resource.loading} onClick={() => setCursors(previous => previous.slice(0, -1))}><ChevronLeft size={18} /></button><span>{f("page", { page: cursors.length })}</span><button className="icon-button" title={f("next")} aria-label={f("next")} disabled={!resource.data?.nextCursor || resource.loading} onClick={() => setCursors(previous => [...previous, resource.data.nextCursor])}><ChevronRight size={18} /></button></div><ExportTray revision={exportRevision} /></>}
    {detail.data && <DetailDrawer key={detail.data.id} tryon={detail.data} onClose={() => setDetailId("")} onDownload={row => downloadImage(row.resultImage, `modelshot-${row.id}.png`).catch(fail)} onDelete={remove} deleting={deleting} onChanged={() => { detail.reload(); resource.reload(); }} />}
  </main>;
}
