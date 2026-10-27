"use client";

import { useState } from "react";
import Modal from "@/components/ui/Modal";
import { LockKeyhole, UnlockKeyhole, X } from "lucide-react";

export default function HtmlImageSize({ image, onClose, onApply, zh }) {
  const [width, setWidth] = useState(image.width), [height, setHeight] = useState(image.height), [locked, setLocked] = useState(true);
  const [ratio, setRatio] = useState(image.width / Math.max(1, image.height));
  const t = (cn, en) => zh ? cn : en;
  const bound = value => Math.max(1, Math.min(8192, Math.round(Number(value) || 1)));
  function size(axis, value) {
    const next = bound(value);
    if (axis === "width") { setWidth(next); if (locked) setHeight(bound(next / ratio)); }
    else { setHeight(next); if (locked) setWidth(bound(next * ratio)); }
  }
  return <Modal label={t("调整图片大小", "Resize image")} className="cw-image-size-dialog" onClose={onClose}>
    <header><strong>{t("调整图片大小", "Resize image")}</strong><button aria-label={t("关闭", "Close")} onClick={onClose}><X size={17} /></button></header>
    {/* The source is the already loaded, authenticated raster derivative. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={image.src} alt={t("图片预览", "Image preview")} />
    <div className="cw-image-size-fields"><label>{t("宽度", "Width")}<input type="number" min={1} max={8192} value={width} onChange={event => size("width", event.target.value)} />px</label>
      <button aria-label={t("锁定宽高比", "Lock aspect ratio")} aria-pressed={locked} onClick={() => { if (!locked) setRatio(width / height); setLocked(value => !value); }}>{locked ? <LockKeyhole size={17} /> : <UnlockKeyhole size={17} />}</button>
      <label>{t("高度", "Height")}<input type="number" min={1} max={8192} value={height} onChange={event => size("height", event.target.value)} />px</label></div>
    <div className="cw-image-size-presets"><span>{t("预设", "Presets")}</span>{[0.5, 0.75, 1, 1.5].map(scale => <button key={scale} onClick={() => { setWidth(bound(image.width * scale)); setHeight(bound(image.height * scale)); }}>{scale * 100}%</button>)}</div>
    <small>{t("预览图原始尺寸", "Preview image dimensions")}: {image.naturalWidth} × {image.naturalHeight} px</small>
    <footer><button onClick={onClose}>{t("取消", "Cancel")}</button><button onClick={() => onApply(width, height)}>{t("确定", "Apply")}</button></footer>
  </Modal>;
}
