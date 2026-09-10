"use client";

import { useRef, useState } from "react";
import { Upload, Plus, X, LoaderCircle, Shirt } from "lucide-react";
import { useTranslations } from "next-intl";

export default function AssetRail({ images, batchMode, busy, uploading, onFiles, onRemove }) {
  const t = useTranslations("workspace");
  const input = useRef(null);
  const [dragging, setDragging] = useState(false);
  return <aside className="asset-panel">
    <div className="panel-heading"><span>{t("assets")}</span><span className="count-label">{String(images.length).padStart(2, "0")}</span></div>
    <div className={`upload-zone ${dragging ? "dragging" : ""}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); if (!busy) onFiles(Array.from(e.dataTransfer.files)); }}>
      <button disabled={busy} onClick={() => input.current.click()}>
        <span className="upload-symbol">{uploading ? <LoaderCircle size={23} className="animate-spin" /> : <Upload size={23} />}</span>
        <strong>{t(dragging ? "drag" : "drop")}</strong><span>{t("dropHint")}</span>
      </button>
      <input ref={input} type="file" multiple={batchMode} accept="image/png,image/jpeg,image/webp" hidden onChange={e => { onFiles(Array.from(e.target.files || [])); e.target.value = ""; }} />
    </div>
    <div className="asset-list">
      {images.map((url, index) => <div key={`${url}-${index}`} className="asset-item"><img src={url} alt={`${t("preview")} ${index + 1}`} /><div><span>{t("assets")} {String(index + 1).padStart(2, "0")}</span><small>{t("preview")}</small></div><button className="icon-button" disabled={busy} title={t("remove")} aria-label={`${t("remove")} ${index + 1}`} onClick={() => onRemove(index)}><X size={15} /></button></div>)}
      {images.length === 0 && <div className="asset-empty"><Shirt size={23} strokeWidth={1.25} /><span>{t("emptyHint")}</span></div>}
    </div>
    {batchMode && images.length > 0 && <button className="button compact w-full" disabled={busy} onClick={() => input.current.click()}><Plus size={15} />{t("add")}</button>}
    <div className="asset-panel-footer"><span className="status-dot" />{t("batchCount", { count: images.length })}</div>
  </aside>;
}
