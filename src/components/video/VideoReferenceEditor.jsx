"use client";

import { useRef } from "react";
import { ArrowLeft, ArrowRight, ImagePlus, RefreshCw, X } from "lucide-react";
import AssetImage from "@/components/studio/AssetImage";
import { previewUrl } from "@/lib/studio/image-url";
import { assignVideoReferenceRoles, moveVideoReference, referenceRole, videoReferenceError } from "@/lib/video/references";
import "./video-controls.css";

const labels = {
  first_frame: ["首帧", "First frame"], last_frame: ["尾帧", "Last frame"],
  reference_image: ["参考图片", "Image reference"], reference_video: ["参考视频", "Video reference"], reference_audio: ["参考音频", "Audio reference"],
};

export default function VideoReferenceEditor({ media, offer, onChange, onAdd, onReplace, disabled = false, lockedIds = [], motion = false, zh = true }) {
  const replacementInput = useRef(null), replacement = useRef(null);
  const text = (cn, en) => zh ? cn : en;
  const layout = motion ? "reference" : offer?.referenceLayout || (offer?.referenceMode === "first_frame" ? "frames" : "reference");
  const mismatch = !motion && media.length && videoReferenceError({ ...offer, referenceLayout: layout }, media);
  const roles = media.map((item, index) => referenceRole(item, index, media, layout));
  const slots = (layout === "frames" ? ["first_frame", "last_frame"] : layout === "first_frame" ? ["first_frame"] : []).filter(role => !roles.includes(role));
  return <div className="vg-references" data-layout={layout} aria-label={text("创作素材", "Creative references")}>
    <div className="vg-reference-list">
      {media.map((item, index) => {
        const role = referenceRole(item, index, media, layout), label = labels[role]?.[zh ? 0 : 1] || role;
        return <article className="vg-reference" key={item.id}>
          <div className="vg-reference-preview">
            {item.type === "image" ? <AssetImage unoptimized fill sizes="112px" src={previewUrl(item.id, 320)} alt={item.name} />
              : item.type === "video" ? <video src={`/api/assets/${item.id}`} controls playsInline preload="metadata" aria-label={item.name} />
              : <audio src={`/api/assets/${item.id}`} controls preload="none" aria-label={item.name} />}
          </div>
          <strong>{motion ? text("素材", "Media") : label} {index + 1}</strong>
          <span title={item.name}>{item.name}</span>
          {item.type !== "image" && <small>{Number(item.duration || 0).toFixed(1)}s</small>}
          <div className="vg-reference-actions">
            {onReplace && <button type="button" disabled={disabled || lockedIds.includes(item.id)} aria-label={text(`替换 ${item.name}`, `Replace ${item.name}`)} onClick={() => { replacement.current = item; replacementInput.current.accept = item.type === "image" ? "image/png,image/jpeg,image/webp" : item.type === "video" ? "video/mp4,video/quicktime" : "audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a"; replacementInput.current.click(); }}><RefreshCw size={13} /></button>}
            <button type="button" disabled={disabled || index === 0} aria-label={text(`前移 ${item.name}`, `Move ${item.name} earlier`)} onClick={() => onChange(moveVideoReference(media, item.id, -1))}><ArrowLeft size={13} /></button>
            <button type="button" disabled={disabled || index === media.length - 1} aria-label={text(`后移 ${item.name}`, `Move ${item.name} later`)} onClick={() => onChange(moveVideoReference(media, item.id, 1))}><ArrowRight size={13} /></button>
            <button type="button" disabled={disabled || lockedIds.includes(item.id)} aria-label={text(`移除 ${item.name}`, `Remove ${item.name}`)} onClick={() => onChange(media.filter(row => row.id !== item.id))}><X size={13} /></button>
          </div>
        </article>;
      })}
      {onAdd && slots.map(role => <button type="button" key={role} className="vg-frame-slot" disabled={disabled} onClick={onAdd}><ImagePlus size={21} /><span>{labels[role][zh ? 0 : 1]}</span></button>)}
    </div>
    {onReplace && <input type="file" hidden ref={replacementInput} onChange={event => { if (event.target.files.length && replacement.current && !disabled) onReplace(event.target.files, replacement.current.id); event.target.value = ""; replacement.current = null; }} />}
    {mismatch ? <div className="vg-reference-warning" role="status"><span>{text("素材用途与当前模型不一致，原素材已保留。", "Reference roles do not match this model. Your media is preserved.")}</span><button type="button" disabled={disabled || layout === "none"} onClick={() => onChange(assignVideoReferenceRoles(media, layout))}>{text("按当前模式重新分配用途", "Assign roles for this mode")}</button></div> : null}
    {!motion && offer && <small className="vg-reference-caption">{layout === "frames" ? text("首帧决定开场，尾帧决定结束画面；箭头可交换画面。", "First and last frames define the endpoints. Use the arrows to swap them.") : layout === "first_frame" ? text("图片作为视频首帧。", "The image is used as the first frame.") : layout === "none" ? text("当前模型使用文字生成，不接收参考素材。", "This model uses text without reference media.") : text("参考素材按显示顺序提交给模型。", "References are submitted in the displayed order.")}</small>}
  </div>;
}
