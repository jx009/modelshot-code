"use client";

import { useRef, useState } from "react";
import { X } from "lucide-react";
import Modal from "@/components/ui/Modal";
import AssetLibrary from "@/components/studio/AssetLibrary";
import { creationError } from "./creation-errors";
import "./reference-assets.css";

export default function WebImagePicker({ target, maxSelection, onSelect, onClose, zh }) {
  const gate = useRef(false), [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const text = (cn, en) => zh ? cn : en;
  async function select(items) {
    if (gate.current) return;
    gate.current = true; setBusy(true); setError(null);
    try { await onSelect(items, target); onClose(); }
    catch (error) { setError(error); }
    finally { gate.current = false; setBusy(false); }
  }
  const title = target ? text("替换网页图片", "Replace website image") : text("添加网页图片", "Add website images");
  return <Modal className="cw-reference-dialog" label={title} onClose={() => { if (!gate.current) onClose(); }}>
    <header><strong>{title}</strong><button type="button" disabled={busy} aria-label={text("关闭图片选择", "Close image picker")} onClick={onClose}><X size={18} /></button></header>
    {target && <p>{text(`将替换 ${target.path}，所有引用此文件的页面都会更新。`, `Replace ${target.path}. Every page using this file will show the new image.`)}</p>}
    {error && <p className="cw-error" role="alert">{creationError(error, zh)}</p>}
    <AssetLibrary maxSelection={target ? 1 : maxSelection} onSelect={select} />
  </Modal>;
}
