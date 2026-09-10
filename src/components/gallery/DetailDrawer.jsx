"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Trash2, X, CopyPlus, Maximize2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import ImageViewer from "@/components/ui/ImageViewer";

export default function DetailDrawer({ tryon, onClose, onDownload, onDelete, deleting }) {
  const t = useTranslations("workspace");
  const tg = useTranslations("gallery");
  const locale = useLocale();
  const ref = useRef(null);
  const [confirming, setConfirming] = useState(false);
  const [viewer, setViewer] = useState(false);
  const open = !!tryon;
  useEffect(() => {
    if (!open) return;
    const dialog = ref.current;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => { dialog.close(); document.body.style.overflow = previous; };
  }, [open]);
  if (!tryon) return null;
  const statusKey = tryon.status === "needs_review" ? "review" : tryon.status === "completed" ? "ready" : tryon.status === "failed" ? "failed" : "processing";
  const billing = { credits: "billingCredits", subscription: "billingSubscription", custom_key: "billingCustomKey" }[tryon.billingType];
  return <dialog ref={ref} className="detail-dialog" aria-labelledby="detail-title" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="detail-header"><h2 id="detail-title">{t("details")}</h2><span className={`shot-status ${statusKey}`}>{t(statusKey)}</span><button className="icon-button ml-auto" aria-label={t("close")} title={t("close")} onClick={onClose}><X size={19} /></button></div>
    <div className="detail-content"><div className="detail-preview"><img src={tryon.resultImage || tryon.clothesImage} alt={t(tryon.resultImage ? "result" : "preview")} /><button className="icon-button" aria-label={t("zoom")} title={t("zoom")} onClick={() => setViewer(true)}><Maximize2 size={18} /></button></div>
      <aside className="detail-info"><dl>{[
        [t("date"), new Date(tryon.createTime).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })],
        [t("ratio"), tryon.aspectRatio], [t("engine"), tryon.provider || "-"], [t("billing"), billing ? tg(billing) : "-"],
      ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        <div className="detail-original"><h3>{t("preview")}</h3><img src={tryon.clothesImage} alt={t("preview")} /></div>
        {tryon.prompt && <details className="detail-prompt"><summary>{t("prompt")}</summary><p>{tryon.prompt}</p></details>}
      </aside>
    </div>
    <div className="detail-actions">{confirming ? <><span className="text-sm mr-auto">{t("deleteConfirm")}</span><button className="button compact" disabled={deleting} onClick={() => setConfirming(false)}>{t("cancel")}</button><button className="button danger compact" disabled={deleting} onClick={() => onDelete(tryon.id)}><Trash2 size={15} />{t("delete")}</button></> : <><button className="icon-button danger" disabled={deleting || !["completed", "failed", "needs_review"].includes(tryon.status)} aria-label={t("delete")} title={t("delete")} onClick={() => setConfirming(true)}><Trash2 size={17} /></button><Link className="button compact ml-auto" href={`/studio?id=${encodeURIComponent(tryon.id)}`}><CopyPlus size={16} />{t("reuse")}</Link><button className="button primary compact" disabled={!tryon.resultImage} onClick={() => onDownload(tryon)}><Download size={16} />{t("download")}</button></>}</div>
    {viewer && <ImageViewer src={tryon.resultImage || tryon.clothesImage} onClose={() => setViewer(false)} />}
  </dialog>;
}
