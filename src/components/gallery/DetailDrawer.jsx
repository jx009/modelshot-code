"use client";
import AssetImage from "@/components/ui/AssetImage";

import { useEffect, useRef, useState } from "react";
import { Download, Archive, X, CopyPlus, Maximize2, Columns2, Check, XCircle, RefreshCw, Ban } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import ImageViewer from "@/components/ui/ImageViewer";
import { api, terminalStatus } from "@/lib/client-api";

export default function DetailDrawer({ tryon, onClose, onDownload, onDelete, deleting, onChanged }) {
  const t = useTranslations("workspace");
  const tg = useTranslations("gallery");
  const f = useTranslations("flow");
  const locale = useLocale();
  const ref = useRef(null);
  const [confirming, setConfirming] = useState(false);
  const [viewer, setViewer] = useState(false);
  const [compare, setCompare] = useState(false);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const open = !!tryon;
  useEffect(() => {
    if (!open) return;
    const dialog = ref.current;
    const focused = document.activeElement;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => { dialog.close(); document.body.style.overflow = previous; if (focused?.isConnected) focused.focus(); };
  }, [open]);
  if (!tryon) return null;
  const statusKey = tryon.qaStatus === "needs_review" ? "review" : tryon.status === "succeeded" ? "ready" : tryon.status === "failed" ? "failed" : "processing";
  async function action(url, body, method = "POST") {
    setWorking(true);
    try { await api(url, { method, body }); onChanged?.(); } catch (err) { setError(f.has(`errors.${err.code}`) ? f(`errors.${err.code}`) : f("requestFailed")); } finally { setWorking(false); }
  }
  const billing = { credits: "billingCredits", subscription: "billingSubscription", custom_key: "billingCustomKey" }[tryon.billingType];
  return <dialog ref={ref} className="detail-dialog" aria-labelledby="detail-title" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="detail-header"><h2 id="detail-title">{t("details")}</h2><span className={`shot-status ${statusKey}`}>{t(statusKey)}</span><button className="icon-button ml-auto" aria-label={t("close")} title={t("close")} onClick={onClose}><X size={19} /></button></div>
    <div className="detail-content"><div className={`detail-preview ${compare ? "comparison" : ""}`}>{compare && <AssetImage src={tryon.clothesImage} alt={t("preview")} />}<AssetImage src={tryon.resultImage || tryon.clothesImage} alt={t(tryon.resultImage ? "result" : "preview")} /><div className="detail-image-tools"><button className="icon-button" aria-label={t("compare")} title={t("compare")} aria-pressed={compare} disabled={!tryon.resultImage} onClick={() => setCompare(!compare)}><Columns2 size={18} /></button><button className="icon-button" aria-label={t("zoom")} title={t("zoom")} onClick={() => setViewer(true)}><Maximize2 size={18} /></button></div></div>
      <aside className="detail-info"><dl>{[
        [t("date"), new Date(tryon.createTime).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })],
        [t("ratio"), tryon.aspectRatio], [t("engine"), tryon.provider || "-"], [t("billing"), billing ? tg(billing) : "-"],
        [f("sku"), tryon.sku || "-"], [f("quality"), f(`qa_${tryon.qaStatus || "pending"}`)],
        [f("metadata"), f.has(tryon.metadataStatus) ? f(tryon.metadataStatus) : tryon.metadataStatus],
        [f("outputSize"), tryon.snapshot?.delivery ? `${tryon.snapshot.delivery.width} × ${tryon.snapshot.delivery.height}` : "-"],
      ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        <div className="detail-original"><h3>{t("preview")}</h3><AssetImage src={tryon.clothesImage} alt={t("preview")} /></div>
        {tryon.status === "succeeded" && <div className="review-controls"><h3>{f("manualReview")}</h3><div className="mode-switch">{[["approved", Check], ["rejected", XCircle]].map(([decision, Icon]) => <button key={decision} title={f(decision)} aria-label={f(decision)} aria-pressed={tryon.reviewDecision === decision} disabled={working} onClick={() => action("/api/tryons", { id: tryon.id, decision: tryon.reviewDecision === decision ? "unreviewed" : decision }, "PATCH")}><Icon size={17} /></button>)}</div><span>{f(tryon.reviewDecision || "unreviewed")}</span></div>}
        {tryon.qualityReport?.evidence && <p className="quality-evidence">{tryon.qualityReport.evidence}</p>}
        {tryon.qaStatus === "error" && <button className="button compact" disabled={working} onClick={() => action(`/api/jobs/${tryon.id}/retry-step`, { kind: "qa" })}><RefreshCw size={15} />{f("retryQuality")}</button>}
        {tryon.exportStatus === "error" && <button className="button compact" disabled={working} onClick={() => action(`/api/jobs/${tryon.id}/retry-step`, { kind: "delivery" })}><RefreshCw size={15} />{f("retryDelivery")}</button>}
        {tryon.originalAssetId && <button className="button compact" onClick={() => onDownload({ ...tryon, resultImage: `/api/assets/${tryon.originalAssetId}` })}><Download size={15} />{f("original")}</button>}
        {tryon.snapshot && <p className="snapshot-version">{f("snapshotVersion", { version: tryon.snapshot.version })}</p>}
        {error && <p role="alert">{error}</p>}
        {tryon.prompt && <details className="detail-prompt"><summary>{t("prompt")}</summary><p>{tryon.prompt}</p></details>}
      </aside>
    </div>
    <div className="detail-actions">{confirming ? <><span className="text-sm mr-auto">{f("archive")}</span><button className="button compact" disabled={deleting} onClick={() => setConfirming(false)}>{t("cancel")}</button><button className="button compact" disabled={deleting} onClick={() => onDelete(tryon.id)}><Archive size={15} />{f("archive")}</button></> : <><button className="icon-button" disabled={deleting || !terminalStatus(tryon.status)} aria-label={f("archive")} title={f("archive")} onClick={() => setConfirming(true)}><Archive size={17} /></button>{!terminalStatus(tryon.status) && <button className="icon-button" title={f("cancelJob")} aria-label={f("cancelJob")} onClick={() => action(`/api/jobs/${tryon.id}/cancel`)}><Ban size={17} /></button>}<Link className="button compact ml-auto" href={`/studio?id=${encodeURIComponent(tryon.id)}${["failed", "cancelled"].includes(tryon.status) ? "&retry=1" : ""}`}><CopyPlus size={16} />{t("reuse")}</Link><button className="button primary compact" disabled={!tryon.resultImage} onClick={() => onDownload(tryon)}><Download size={16} />{t("download")}</button></>}</div>
    {viewer && <ImageViewer src={tryon.resultImage || tryon.clothesImage} onClose={() => setViewer(false)} />}
  </dialog>;
}
