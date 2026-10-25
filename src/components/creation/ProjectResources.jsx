"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, Download, FileText, FolderOpen, ImageIcon, X } from "lucide-react";
import Image from "@/components/studio/AssetImage";
import Modal from "@/components/ui/Modal";
import { downloadUrl, previewUrl } from "@/lib/studio/image-url";
import { MessageText } from "./CreationMessage";

export default function ProjectResources({ resources, zh }) {
  const [expanded, setExpanded] = useState(true), [selected, setSelected] = useState(null);
  const t = (cn, en) => zh ? cn : en;
  const images = resources.images;
  const image = selected?.type === "image" ? images.find(item => item.id === selected.id) : null;
  const label = item => (item.pageTitle || t("素材", "Image")) + " · " + t("配图", "Artwork") + " " + (images.indexOf(item) + 1);
  const showingDesign = selected?.type === "design" && resources.design;
  function downloadDesign() {
    const url = URL.createObjectURL(new Blob([resources.design], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "DESIGN.md"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="cw-file-resources">
    {images.length > 0 && <><button className="cw-resource-folder" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}<FolderOpen size={14} /><span>{t("配图素材", "Images")}</span><small>{images.length}</small></button>
      {expanded && images.map(item => <button className="cw-resource-image" key={item.id} title={label(item)} onClick={() => setSelected({ type: "image", id: item.id })}><ImageIcon size={14} /><span>{label(item)}</span></button>)}</>}
    {resources.design && <button onClick={() => setSelected({ type: "design" })}><FileText size={14} /><span>DESIGN.md</span></button>}
    {(image || showingDesign) && createPortal(<Modal className="cw-resource-dialog" label={image ? label(image) : "DESIGN.md"} onClose={() => setSelected(null)}>
      <header><strong>{image ? label(image) : "DESIGN.md"}</strong>{image ? <a href={downloadUrl(image.id)} download><Download size={15} />{t("下载", "Download")}</a> : <button onClick={downloadDesign}><Download size={15} />{t("下载", "Download")}</button>}<button aria-label={t("关闭资源预览", "Close resource preview")} onClick={() => setSelected(null)}><X size={17} /></button></header>
      {image ? <div className="cw-resource-preview"><Image src={previewUrl(image.id, 1280)} unoptimized fill sizes="80vw" alt={label(image)} /></div> : <div className="cw-resource-markdown"><MessageText value={resources.design} /></div>}
    </Modal>, document.body)}
  </div>;
}
