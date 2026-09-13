"use client";

import { useRef, useState } from "react";
import { ImagePlus, Images, LoaderCircle, Plus, Upload, X } from "lucide-react";
import { useTranslations } from "next-intl";
import AssetImage from "@/components/ui/AssetImage";

const referenceRoles = ["detail", "style", "layout", "scene"];

export default function AssetRail({ images, referenceImages = [], batchMode, busy, uploading, onFiles, onReferenceFiles, onRemove, onRemoveReference }) {
  const t = useTranslations("workspace");
  const input = useRef(null);
  const referenceInput = useRef(null);
  const [referenceRole, setReferenceRole] = useState("detail");
  const [dragging, setDragging] = useState(false);

  return <aside className="asset-panel">
    <div className="panel-heading"><span>{t("assets")}</span><span className="count-label">{String(images.length + referenceImages.length).padStart(2, "0")}</span></div>
    <div className={`upload-zone ${dragging ? "dragging" : ""}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); if (!busy) onFiles(Array.from(event.dataTransfer.files)); }}>
      <button disabled={busy} onClick={() => input.current.click()}>
        <span className="upload-symbol">{uploading ? <LoaderCircle size={23} className="animate-spin" /> : <Upload size={23} />}</span>
        <strong>{t(dragging ? "drag" : "drop")}</strong><span>{t("dropHint")}</span>
      </button>
      <input ref={input} type="file" multiple={batchMode} accept="image/png,image/jpeg,image/webp" hidden onChange={event => { onFiles(Array.from(event.target.files || [])); event.target.value = ""; }} />
    </div>
    <div className="asset-list">
      <div className="asset-list-heading"><span>{t("primaryProducts")}</span><small>{images.length}</small></div>
      {images.map((url, index) => <div key={`${url}-${index}`} className="asset-item"><AssetImage src={url} alt={`${t("preview")} ${index + 1}`} /><div><span>{batchMode ? `${t("productImage")} ${String(index + 1).padStart(2, "0")}` : t("primaryProduct")}</span><small>{t("sourceOfTruth")}</small></div><button className="icon-button" disabled={busy} title={t("remove")} aria-label={`${t("remove")} ${index + 1}`} onClick={() => onRemove(index)}><X size={15} /></button></div>)}
      {images.length === 0 && <div className="asset-empty"><Images size={23} strokeWidth={1.25} /><span>{t("emptyHint")}</span></div>}
      {batchMode && images.length > 0 && <button className="button compact asset-add-button" disabled={busy} onClick={() => input.current.click()}><Plus size={15} />{t("addProduct")}</button>}

      <div className="asset-list-heading reference-heading"><span>{t("references")}</span><small>{referenceImages.length}/15</small></div>
      <div className="reference-uploader">
        <select aria-label={t("referenceRole")} value={referenceRole} disabled={busy} onChange={event => setReferenceRole(event.target.value)}>{referenceRoles.map(role => <option key={role} value={role}>{t(`referenceRoles.${role}`)}</option>)}</select>
        <button className="icon-button" disabled={busy || referenceImages.length >= 15} title={t("addReference")} aria-label={t("addReference")} onClick={() => referenceInput.current.click()}><ImagePlus size={17} /></button>
        <input ref={referenceInput} type="file" multiple accept="image/png,image/jpeg,image/webp" hidden onChange={event => { onReferenceFiles(Array.from(event.target.files || []), referenceRole); event.target.value = ""; }} />
      </div>
      {referenceImages.map((reference, index) => <div key={`${reference.id}-${index}`} className="asset-item reference-item"><AssetImage src={reference.id} alt={`${t("references")} ${index + 1}`} /><div><span>{t(`referenceRoles.${reference.role}`)}</span><small>{t("referenceApplied")}</small></div><button className="icon-button" disabled={busy} title={t("remove")} aria-label={`${t("removeReference")} ${index + 1}`} onClick={() => onRemoveReference(index)}><X size={15} /></button></div>)}
      {referenceImages.length === 0 && <p className="reference-empty">{t("referenceHint")}</p>}
    </div>
    <div className="asset-panel-footer"><span className="status-dot" />{t("assetCount", { products: images.length, references: referenceImages.length })}</div>
  </aside>;
}
