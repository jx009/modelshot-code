"use client";
import AssetImage from "@/components/ui/AssetImage";

import { useState } from "react";
import { Camera, Download, Maximize2, Columns2, LoaderCircle, TriangleAlert, Grid2X2 } from "lucide-react";
import { useTranslations } from "next-intl";
import ImageViewer from "@/components/ui/ImageViewer";

export default function VariantCanvas({ variants, selectedId, onSelect, onDownload, garmentImage, busy }) {
  const t = useTranslations("workspace");
  const [compare, setCompare] = useState(false);
  const [grid, setGrid] = useState(false);
  const [viewer, setViewer] = useState("");
  const selected = variants.find(v => v.id === selectedId) || variants[0];
  const result = selected?.resultImage;
  const original = selected?.clothesImage || garmentImage;
  let qaKey = "unchecked";
  if (selected?.qaStatus === "needs_review") qaKey = "review";
  else if (selected?.qaStatus === "passed") qaKey = "passed";
  return <section className="canvas-panel" aria-label={t("output")}>
    <div className="canvas-toolbar"><div className="flex items-center gap-2 min-w-0"><span className="status-dot" /><span>{t("output")}</span>{variants.length > 0 && <span className="count-label">{variants.length}</span>}</div>
      <div className="flex items-center gap-1">
        {variants.length > 1 && <button className="icon-button" title={t("grid")} aria-label={t("grid")} aria-pressed={grid} onClick={() => setGrid(!grid)}><Grid2X2 size={17} /></button>}
        <button className="icon-button" title={t("compare")} aria-label={t("compare")} disabled={!result} aria-pressed={compare} onClick={() => { setCompare(!compare); setGrid(false); }}><Columns2 size={17} /></button>
        <button className="icon-button" title={t("zoom")} aria-label={t("zoom")} disabled={!result && !original} onClick={() => setViewer(result || original)}><Maximize2 size={17} /></button>
        <button className="icon-button" title={t("download")} aria-label={t("download")} disabled={!result} onClick={() => onDownload(selected)}><Download size={17} /></button>
      </div>
    </div>
    <div className={`canvas-stage ${grid ? "canvas-grid" : ""}`}>
      {grid && variants.length > 0 ? variants.map(v => <button key={v.id} className={`variant-tile ${v.id === selectedId ? "selected" : ""}`} onClick={() => { onSelect(v.id); setGrid(false); }}><AssetImage src={v.resultImage || v.clothesImage} alt={t(v.resultImage ? "result" : "preview")} /><span className="image-caption">{t(v.status === "failed" ? "failed" : v.resultImage ? "ready" : "processing")}</span></button>) : (result || original) ? <div className={`canvas-images ${compare && result ? "comparing" : ""}`}>
        {compare && result && <figure><AssetImage src={original} alt={t("preview")} /><figcaption>{t("preview")}</figcaption></figure>}
        <figure><AssetImage src={result || original} alt={t(result ? "result" : "preview")} /><figcaption>{t(result ? "result" : "preview")}{selected?.aspectRatio && <span>{selected.aspectRatio}</span>}</figcaption>
          {busy && !result && <span className="canvas-progress"><LoaderCircle size={17} className="animate-spin" />{t("processing")}</span>}
          {selected?.status === "failed" && <span className="canvas-progress text-danger"><TriangleAlert size={17} />{t("failed")}</span>}
          {result && <span className={`canvas-quality ${qaKey}`}>{qaKey === "review" && <TriangleAlert size={14} />}{t(qaKey)}</span>}
        </figure>
      </div> : <div className="canvas-empty"><div className="empty-viewfinder"><Camera size={38} strokeWidth={1.2} /></div><h2>{t("empty")}</h2><p>{t("emptyHint")}</p></div>}
    </div>
    {viewer && <ImageViewer src={viewer} onClose={() => setViewer("")} />}
  </section>;
}
