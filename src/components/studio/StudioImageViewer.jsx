"use client";

import Image from "@/components/studio/AssetImage";
import { useEffect, useRef, useState } from "react";
import { Download, FlipHorizontal2, FlipVertical2, Maximize, Minus, Plus, RotateCcw, RotateCw, X } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { previewUrl, downloadUrl } from "@/lib/studio/image-url";
import { DEFAULT_PREVIEW_VIEW, MAX_PREVIEW_ZOOM, MIN_PREVIEW_ZOOM, zoomPreview } from "@/lib/studio/preview-transform";
import StudioPreviewImage from "./StudioPreviewImage";
import "./image-viewer.css";

export default function StudioImageViewer(props) {
  return <Modal className="ms-image-preview" label={props.zh ? "图片预览" : "Image preview"} onClose={props.onClose}>
    <PreviewSession key={props.assetId} {...props} />
  </Modal>;
}

function PreviewSession({ assetId, initialImage, layers, zh, onSelect, onClose, onReuse, onVariation, onCommerce }) {
  const [view, setView] = useState(DEFAULT_PREVIEW_VIEW);
  const [comparing, setComparing] = useState(false), [working, setWorking] = useState(false);
  const selected = layers.find(layer => layer.assetId === assetId);
  const sourceAssetId = selected?.sourceAssetIds?.find(id => id !== assetId);
  const activeThumbnail = useRef(null);
  const t = (cn, en) => zh ? cn : en;
  const reset = () => setView({ ...DEFAULT_PREVIEW_VIEW });
  useEffect(() => { activeThumbnail.current?.scrollIntoView({ block: "nearest", inline: "center" }); }, []);
  useEffect(() => {
    const keyboard = event => {
      if (event.metaKey || event.ctrlKey || event.altKey || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
      if (["+", "=", "-", "0"].includes(event.key)) {
        event.preventDefault();
        setView(current => event.key === "0" ? { ...DEFAULT_PREVIEW_VIEW } : zoomPreview(current, current.zoom + (event.key === "-" ? -.25 : .25)));
      }
      if (["ArrowLeft", "ArrowRight"].includes(event.key) && layers.length > 1) {
        event.preventDefault();
        const index = layers.findIndex(layer => layer.assetId === assetId);
        onSelect(layers[(index + (event.key === "ArrowLeft" ? -1 : 1) + layers.length) % layers.length].assetId);
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [assetId, layers, onSelect]);
  return <div className="ms-preview-shell">
    <button autoFocus className="ms-preview-close ms-icon" title={t("关闭预览", "Close preview")} onClick={onClose}><X size={22} /></button>
    {comparing && sourceAssetId ? <div className="ms-preview-compare"><section><span>{t("原图／首张参考", "Original / first reference")}</span><StudioPreviewImage key={sourceAssetId} assetId={sourceAssetId} view={view} onView={setView} zh={zh} /></section><section><span>{t("当前结果", "Current result")}</span><StudioPreviewImage key={assetId} assetId={assetId} initialImage={initialImage} view={view} onView={setView} zh={zh} /></section></div> : <StudioPreviewImage assetId={assetId} initialImage={initialImage} view={view} onView={setView} zh={zh} />}
    <div className="ms-preview-dock">
      <div className="ms-preview-result-actions">
        {sourceAssetId && <button type="button" aria-pressed={comparing} onClick={() => { reset(); setComparing(value => !value); }}>{t("对比原图", "Compare original")}</button>}
        {onVariation && selected && <button type="button" disabled={working} onClick={() => onVariation(selected)}>{t("以此为基准创作", "Create from this image")}</button>}
        {onCommerce && selected && <button type="button" disabled={working} onClick={async () => { setWorking(true); try { await onCommerce(selected); } finally { setWorking(false); } }}>{t("用作电商套图基准", "Use for a product image series")}</button>}
        {onReuse && selected?.sourceJobId && <button type="button" disabled={working} onClick={async () => { setWorking(true); try { await onReuse(selected); } finally { setWorking(false); } }}>{t("复用创作参数", "Reuse settings")}</button>}
      </div>
      {layers.length > 1 && <div className="ms-preview-history" aria-label={t("项目图片", "Project images")}>{layers.map((layer, index) => <button key={layer.id} ref={layer.assetId === assetId ? activeThumbnail : undefined} className={layer.assetId === assetId ? "active" : ""} aria-label={layer.name} aria-current={layer.assetId === assetId ? "true" : undefined} onClick={() => onSelect(layer.assetId)}><Image unoptimized src={previewUrl(layer.assetId, 320)} width={64} height={64} alt="" /><span>{index + 1}</span></button>)}</div>}
      <div className="ms-preview-controls" role="toolbar" aria-label={t("预览工具", "Preview tools")}>
        <button className="ms-icon" disabled={view.zoom <= MIN_PREVIEW_ZOOM} title={t("缩小预览", "Zoom preview out")} onClick={() => setView(current => zoomPreview(current, current.zoom - .25))}><Minus size={18} /></button>
        <button className="ms-preview-percent" title={t("恢复 75% 居中", "Reset to centered 75%")} onClick={reset}>{Math.round(view.zoom * 100)}%</button>
        <button className="ms-icon" disabled={view.zoom >= MAX_PREVIEW_ZOOM} title={t("放大预览", "Zoom preview in")} onClick={() => setView(current => zoomPreview(current, current.zoom + .25))}><Plus size={18} /></button>
        <i className="ms-preview-divider" />
        <button className="ms-icon" title={t("向左旋转", "Rotate left")} onClick={() => setView(current => ({ ...current, rotation: (current.rotation + 270) % 360, x: 0, y: 0 }))}><RotateCcw size={18} /></button>
        <button className="ms-icon" title={t("向右旋转", "Rotate right")} onClick={() => setView(current => ({ ...current, rotation: (current.rotation + 90) % 360, x: 0, y: 0 }))}><RotateCw size={18} /></button>
        <button className="ms-icon" title={t("水平翻转", "Flip horizontally")} aria-pressed={view.flipX} onClick={() => setView(current => ({ ...current, flipX: !current.flipX }))}><FlipHorizontal2 size={18} /></button>
        <button className="ms-icon" title={t("垂直翻转", "Flip vertically")} aria-pressed={view.flipY} onClick={() => setView(current => ({ ...current, flipY: !current.flipY }))}><FlipVertical2 size={18} /></button>
        <i className="ms-preview-divider" />
        <button className="ms-icon" title={t("重置预览", "Reset preview")} onClick={reset}><Maximize size={17} /></button>
        <a className="ms-icon" href={downloadUrl(assetId)} download="letaidraw.png" title={t("下载原图", "Download image")}><Download size={18} /></a>
      </div>
      <p className="ms-preview-help">{t("滚轮缩放 · 拖动查看 · 双击复位", "Scroll to zoom · Drag to pan · Double-click to reset")}</p>
    </div>
  </div>;
}
