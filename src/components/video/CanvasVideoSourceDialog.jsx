"use client";

import { useState } from "react";
import Modal from "@/components/ui/Modal";
import AssetImage from "@/components/studio/AssetImage";
import { previewUrl } from "@/lib/studio/image-url";
import "./video-controls.css";

export default function CanvasVideoSourceDialog({ sources, zh, busy, onClose, onConfirm }) {
  const [items, setItems] = useState(sources);
  const [mode, setMode] = useState(sources.length === 2 ? "frames" : "reference");
  const text = (cn, en) => zh ? cn : en;
  return <Modal label={text("设置图片用途", "Choose image roles")} className="vg-source-dialog" onClose={busy ? () => {} : onClose}>
    <h2>{text("用这些图片生成视频", "Create a video from these images")}</h2>
    <p>{text("确认素材的顺序和用途，模型限制会在下一步检查。", "Confirm order and roles. Model limits will be checked in the next step.")}</p>
    <div className="vg-mode-choice" role="group" aria-label={text("引用模式", "Reference mode")}>
      <button type="button" disabled={busy || items.length !== 2} aria-pressed={mode === "frames"} onClick={() => setMode("frames")}>{text("首尾帧", "First & last frames")}</button>
      <button type="button" disabled={busy} aria-pressed={mode === "reference"} onClick={() => setMode("reference")}>{text("多图参考", "Image references")}</button>
    </div>
    <div className="vg-reference-list">{items.map((item, index) => <article className="vg-reference" key={item.id}>
      <div className="vg-reference-preview"><AssetImage unoptimized fill src={previewUrl(item.assetId, 320)} sizes="112px" alt={item.name} /></div>
      <strong>{mode === "frames" ? index === 0 ? text("首帧", "First frame") : text("尾帧", "Last frame") : `${text("参考", "Reference")} ${index + 1}`}</strong>
      <span>{item.name}</span>
      <button type="button" disabled={busy || !index} onClick={() => setItems(current => { const next = [...current]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })}>{text("前移", "Move earlier")}</button>
    </article>)}</div>
    {items.length > 30 && <p role="alert">{text("一次最多选择 30 张图片，请减少选择。", "Select at most 30 images.")}</p>}
    <footer><button type="button" disabled={busy} onClick={onClose}>{text("取消", "Cancel")}</button><button type="button" disabled={busy || items.length > 30} onClick={() => onConfirm(items, mode)}>{busy ? text("正在打开…", "Opening…") : text("继续配置", "Continue")}</button></footer>
  </Modal>;
}
