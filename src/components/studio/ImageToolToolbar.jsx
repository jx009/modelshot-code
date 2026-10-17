"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Crop, Download, Eraser, Expand, FolderOpen, Layers3, MessageCircle, MoreHorizontal, Move, ScanText, Scissors, SlidersHorizontal, Sparkles, Type, Video, WandSparkles, ZoomIn } from "lucide-react";
import { getTool } from "@/lib/studio/tool-catalog";
import { imageUrl } from "@/lib/studio/image-url";
import "./image-tool-toolbar.css";

const ICONS = { expand: Expand, upscale: ZoomIn, enhance: Sparkles, describe: WandSparkles, template: WandSparkles, erase: Eraser, inpaint: Scissors, focus: Sparkles, merge: Layers3, "text-edit": Type, translate: Type, ocr: ScanText, "remove-bg": Scissors, split: Layers3, move: Move, crop: Crop, adjust: SlidersHorizontal, video: Video, chat: MessageCircle, library: FolderOpen, download: Download };
const GROUPS = [
  { id: "expand" },
  { id: "quality", zh: "画质提升", en: "Image quality", icon: ZoomIn, items: ["upscale", "enhance"] },
  { id: "prompts", zh: "反推提示词", en: "Reverse prompt", icon: WandSparkles, items: ["describe", "template"] },
  { id: "erase" },
  { id: "local", zh: "局部修改", en: "Local edit", icon: Scissors, items: ["inpaint", "focus", "merge"] },
  { id: "text", zh: "文字编辑", en: "Image text", icon: Type, items: ["text-edit", "translate", "ocr"] },
  { id: "layers", zh: "抠图与图层", en: "Cutout & layers", icon: Layers3, items: ["remove-bg", "split", "move"] },
  { id: "more", zh: "更多", en: "More", icon: MoreHorizontal, items: ["crop", "adjust", "chat", "video", "library", "download"] },
];

export default function ImageToolToolbar({ selected, viewport, capabilities, zh, onChoose, onChat, onSave }) {
  const [open, setOpen] = useState(null);
  const [height, setHeight] = useState(56);
  const root = useRef(null), menu = useRef(null), trigger = useRef(null), timer = useRef(null);
  const menuId = useId();
  const t = (cn, en) => zh ? cn : en;
  const cancelClose = () => clearTimeout(timer.current);
  const scheduleClose = () => { cancelClose(); timer.current = setTimeout(() => setOpen(null), 180); };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    const observer = new ResizeObserver(entries => setHeight(entries[0].target.getBoundingClientRect().height));
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!open) return;
    const outside = event => {
      if (!root.current?.contains(event.target) && !menu.current?.contains(event.target)) setOpen(null);
    };
    const escape = event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(null); trigger.current?.focus(); }
    };
    const reposition = () => setOpen(null);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open]);

  function show(group, button, keyboard = false) {
    cancelClose(); trigger.current = button;
    const rect = button.getBoundingClientRect(), height = group.items.length * 42 + 16;
    const below = window.innerHeight - rect.bottom - 16;
    const above = rect.top - 16;
    const upward = below < Math.min(height, 200) && above > below;
    setOpen({ ...group, left: Math.max(8, Math.min(rect.left, window.innerWidth - 232)),
      ...(upward ? { bottom: window.innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }),
      maxHeight: Math.max(80, upward ? above : below) });
    if (keyboard) requestAnimationFrame(() => menu.current?.querySelector('[role="menuitem"]:not(:disabled)')?.focus());
  }
  function action(id, inMenu = false) {
    const item = getTool(id), capability = capabilities?.tools?.find(row => row.id === id);
    const unavailable = item && !capability?.available && !item.clientOnly && id !== "crop";
    const label = item ? (zh ? item.zh : item.en) : ({ chat: t("添加到聊天", "Add to chat"), library: t("存入素材库", "Save to library"), download: t("下载原图", "Download image") })[id];
    const Icon = ICONS[id] || WandSparkles;
    const hint = unavailable ? t("需管理员启用或配置此工具", "An administrator needs to configure or enable this tool") : item ? `${capability?.cost ?? item.cost} ${t("积分", "credits")}` : "";
    const content = <><Icon size={17} /><span>{label}</span>{unavailable && <i className="ms-setup-dot" />}{inMenu && id === "adjust" && <small>{t("免费", "Free")}</small>}</>;
    if (id === "download") return <a key={id} role="menuitem" href={imageUrl(selected.assetId)} download={`${selected.name}.png`} onClick={() => setOpen(null)}>{content}</a>;
    return <button key={id} role={inMenu ? "menuitem" : undefined} aria-label={label} disabled={unavailable} title={`${label}${hint ? ` · ${hint}` : ""}`} onPointerEnter={inMenu ? undefined : () => setOpen(null)} onClick={() => {
      setOpen(null);
      if (id === "chat") onChat(); else if (id === "library") onSave(); else onChoose(id);
    }}>{content}</button>;
  }

  return <>
    <div ref={root} className="ms-image-tool-toolbar" role="group" aria-label={t("图片工具", "Image tools")} style={{ top: viewport ? Math.max(54, Math.min(viewport.top - height - 14 >= 54 ? viewport.top - height - 14 : viewport.top + viewport.height + 48, viewport.viewportHeight - height - 90)) : 54 }}>
      <div className="ms-context-scroll">{GROUPS.map(group => {
        if (!group.items) return action(group.id);
        const Icon = group.icon, active = open?.id === group.id;
        return <button key={group.id} aria-haspopup="menu" aria-expanded={active} aria-controls={active ? menuId : undefined}
          onPointerEnter={event => { if (event.pointerType === "mouse") show(group, event.currentTarget); }}
          onPointerLeave={scheduleClose} onClick={event => { if (active && event.nativeEvent.pointerType !== "mouse") { cancelClose(); setOpen(null); } else show(group, event.currentTarget); }}
          onKeyDown={event => { if (["ArrowDown", "Enter", " "].includes(event.key)) { event.preventDefault(); show(group, event.currentTarget, true); } }}>
          <Icon size={17} /><span>{zh ? group.zh : group.en}</span><ChevronDown className="ms-tool-chevron" size={13} />
        </button>;
      })}</div>
    </div>
    {open && createPortal(<div ref={menu} id={menuId} className="ms-image-tool-menu" role="menu" aria-label={zh ? open.zh : open.en}
      style={{ left: open.left, top: open.top, bottom: open.bottom, maxHeight: open.maxHeight }} onPointerEnter={cancelClose} onPointerLeave={scheduleClose}
      onKeyDown={event => {
        const items = [...event.currentTarget.querySelectorAll('[role="menuitem"]:not(:disabled)')];
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const index = items.indexOf(document.activeElement);
          const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        }
        if (event.key === "Tab") { setOpen(null); trigger.current?.focus(); }
      }}>{open.items.map(id => action(id, true))}</div>, document.body)}
  </>;
}
