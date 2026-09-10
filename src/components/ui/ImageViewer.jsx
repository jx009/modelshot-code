"use client";

import { useEffect, useRef, useState } from "react";
import { X, ZoomIn, ZoomOut, Scan } from "lucide-react";
import { useTranslations } from "next-intl";

export default function ImageViewer({ src, onClose }) {
  const t = useTranslations("workspace");
  const ref = useRef(null);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    if (!src) return;
    const dialog = ref.current;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => { dialog.close(); document.body.style.overflow = previous; };
  }, [src]);
  return <dialog ref={ref} className="image-viewer" aria-label={t("zoom")} onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="viewer-toolbar">
      <span className="text-sm">{t("zoom")}</span>
      <div className="flex items-center gap-2">
        <button className="icon-button" title={t("zoomOut")} aria-label={t("zoomOut")} disabled={zoom <= 1} onClick={() => setZoom(v => Math.max(1, v - .5))}><ZoomOut size={18} /></button>
        <span className="text-xs tabular-nums w-12 text-center">{zoom * 100}%</span>
        <button className="icon-button" title={t("zoomIn")} aria-label={t("zoomIn")} disabled={zoom >= 3} onClick={() => setZoom(v => Math.min(3, v + .5))}><ZoomIn size={18} /></button>
        <button className="icon-button" title={t("fit")} aria-label={t("fit")} onClick={() => setZoom(1)}><Scan size={18} /></button>
        <button className="icon-button" title={t("close")} aria-label={t("close")} onClick={onClose}><X size={20} /></button>
      </div>
    </div>
    <div className="viewer-image-scroll"><div style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}>{src && <img src={src} alt={t("result")} />}</div></div>
  </dialog>;
}
