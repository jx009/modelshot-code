"use client";

import { lazy, Suspense, useState } from "react";
import { createPortal } from "react-dom";
import { ImagePlus, Paperclip, X } from "lucide-react";
import Image from "@/components/studio/AssetImage";
import Modal from "@/components/ui/Modal";
import { previewUrl } from "@/lib/studio/image-url";
import "./reference-assets.css";

const AssetLibrary = lazy(() => import("@/components/studio/AssetLibrary"));
export const referenceAssetIds = value => Array.isArray(value) ? [...new Set(value.filter(id => typeof id === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(id)))].slice(0, 8) : [];

export function MessageReferenceAssets({ references, zh }) {
  const [open, setOpen] = useState(false);
  const ids = referenceAssetIds((Array.isArray(references) ? references : []).filter(item => item.type === "asset").map(item => item.assetId));
  const files = (Array.isArray(references) ? references : []).filter(item => item.type === "reference" && typeof item.name === "string");
  if (!ids.length && !files.length) return null;
  const count = ids.length + files.length;
  return <div><button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}><Paperclip size={13} />{zh ? `${count} 个参考资料` : `${count} references`}</button>
    {open && <div>{ids.length > 0 && <ReferenceAssets value={ids} readOnly zh={zh} />}<ul className="cw-reference-message-files">{files.map(file => <li key={file.referenceId}>{file.name}</li>)}</ul></div>}</div>;
}

export default function ReferenceAssets({ value, onChange, disabled, readOnly = false, compact = false, hidePicker = false, zh }) {
  const [open, setOpen] = useState(false);
  const text = (cn, en) => zh ? cn : en;
  function select(items) {
    if (disabled) throw new Error(text("请等待当前提交完成。", "Wait for the current submission."));
    const next = [...new Set([...value, ...items.map(item => item.assetId)])];
    if (next.length > 8) throw new Error(text("最多添加 8 张参考图片，请减少选择。", "Select up to 8 reference images."));
    onChange(referenceAssetIds(next)); setOpen(false);
  }
  return <div className={"cw-reference-assets" + (compact ? " is-compact" : "")}>
    {!compact && <div className="cw-reference-assets-list">{value.map((id, index) => <div key={id} className="cw-reference-asset">
      <Image src={previewUrl(id, 320)} unoptimized fill sizes="52px" loading="lazy" alt={text(`参考图片 ${index + 1}`, `Reference image ${index + 1}`)} />
      <span>{index + 1}</span>{!readOnly && <button type="button" disabled={disabled} onClick={() => onChange(value.filter(item => item !== id))} aria-label={text(`移除参考图片 ${index + 1}`, `Remove reference image ${index + 1}`)}><X size={12} /></button>}
    </div>)}</div>}
    {!readOnly && !hidePicker && <button type="button" className="cw-add-reference" aria-label={text("添加参考图片", "Add reference images")} title={text("添加参考图片", "Add reference images")} disabled={disabled || value.length >= 8} onClick={() => setOpen(true)}>{compact ? <ImagePlus size={16} /> : <><Paperclip size={14} />{text("添加素材", "Add assets")}</>}{value.length > 0 && <span>{compact ? value.length : value.length + "/8"}</span>}</button>}
    {open && createPortal(<div onSubmit={event => event.stopPropagation()}><Modal className="cw-reference-dialog" label={text("添加参考图片", "Add reference images")} onClose={() => setOpen(false)}>
      <header><strong>{text("添加参考图片", "Add reference images")}</strong><button type="button" aria-label={text("关闭素材库", "Close assets")} onClick={() => setOpen(false)}><X size={18} /></button></header>
      <Suspense fallback={<p role="status">{text("正在打开素材库…", "Opening assets…")}</p>}><AssetLibrary maxSelection={8 - value.length} onSelect={select} /></Suspense>
    </Modal></div>, document.body)}
  </div>;
}
