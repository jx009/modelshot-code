"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Box, Check, ChevronDown, ImageIcon, Sparkles, X } from "lucide-react";
import "./model-picker.css";

function ModelMark({ model, small = false }) {
  // Stable visual identity without claiming an unconfigured provider or capability.
  const tone = Array.from(model?.id || "image").reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 4;
  return <span aria-hidden="true" className={`mpk-mark mpk-tone-${tone}${small ? " mpk-mark-small" : ""}`}><Sparkles size={small ? 15 : 24} strokeWidth={1.6} /></span>;
}

export default function ModelPicker({ models = [], value, onChange, zh, disabled = false, emptyLabel }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const trigger = useRef(null), panel = useRef(null), options = useRef([]);
  const id = useId();
  const selected = models.find(model => model.id === value);
  const unavailable = disabled || !models.length;
  const expanded = open && !unavailable;
  const positioned = Boolean(position);
  const label = zh ? "生图模型" : "Image model";

  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }

  useLayoutEffect(() => {
    if (!expanded) return;
    function place() {
      const rect = trigger.current.getBoundingClientRect();
      const width = Math.min(400, window.innerWidth - 24);
      const above = Math.max(0, rect.top - 20);
      const below = Math.max(0, window.innerHeight - rect.bottom - 20);
      const up = above >= Math.min(420, below);
      setPosition({ width, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        maxHeight: Math.min(480, up ? above : below),
        ...(up ? { bottom: window.innerHeight - rect.top + 10 } : { top: rect.bottom + 10 }),
        transformOrigin: up ? "bottom left" : "top left" });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [expanded]);

  useLayoutEffect(() => {
    if (!expanded || !positioned) return;
    const option = options.current[Math.max(0, models.findIndex(model => model.id === value))];
    option?.focus({ preventScroll: true });
    option?.scrollIntoView({ block: "nearest" });
  }, [expanded, positioned, models, value]);

  useEffect(() => {
    if (!expanded) return;
    function outside(event) {
      if (!panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("focusin", outside); };
  }, [expanded, models, value]);

  function navigate(event) {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); return; }
    const current = options.current.indexOf(document.activeElement);
    let next;
    if (event.key === "ArrowDown") next = (current + 1) % models.length;
    if (event.key === "ArrowUp") next = (current - 1 + models.length) % models.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = models.length - 1;
    if (next != null) { event.preventDefault(); options.current[next]?.focus(); }
  }

  return <>
    <button ref={trigger} type="button" className="mpk-trigger" aria-label={`${label}${selected ? `：${selected.label}` : ""}`} aria-haspopup="listbox" aria-expanded={expanded} aria-controls={expanded ? id : undefined} disabled={unavailable}
      onClick={() => setOpen(current => !current)} onKeyDown={event => { if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); setOpen(true); } }}>
      <ModelMark model={selected} small /><span className="mpk-trigger-name">{selected?.label || emptyLabel || (zh ? "选择模型" : "Choose model")}</span><ChevronDown className="mpk-chevron" size={14} />
    </button>
    {expanded && createPortal(<div ref={panel} className="mpk-panel" style={position || { visibility: "hidden" }} onKeyDown={navigate} lang={zh ? "zh" : "en"}>
      <header className="mpk-heading"><Box size={20} /><span>{zh ? "模型选择" : "Choose a model"}</span><button type="button" className="mpk-close" aria-label={zh ? "关闭模型选择" : "Close model picker"} onClick={() => close(true)}><X size={18} /></button></header>
      <div className="mpk-category"><ImageIcon size={16} /><span>{zh ? "图片" : "Image"}</span><span className="mpk-count">{models.length}</span></div>
      <div id={id} role="listbox" aria-label={label} className="mpk-list">
        {models.map((model, index) => <button key={model.id} ref={element => { options.current[index] = element; }} type="button" role="option" aria-selected={model.id === value} tabIndex={model.id === value || !selected && index === 0 ? 0 : -1} className="mpk-option" onClick={() => { onChange(model.id); close(true); }}>
          <ModelMark model={model} /><span className="mpk-copy"><span className="mpk-name">{model.label}</span><span className="mpk-description">{model.maxReferenceImages > 0 ? (zh ? `支持生图与参考图编辑 · 最多 ${model.maxReferenceImages} 张参考图` : `Generate & edit · Up to ${model.maxReferenceImages} references`) : (zh ? "根据文字描述生成图片" : "Create images from a text prompt")}</span><span className="mpk-price">{model.creditCost} {zh ? "积分 / 张" : "credits / image"}</span></span>
          <span className="mpk-check">{model.id === value && <Check size={18} />}</span>
        </button>)}
      </div>
    </div>, document.body)}
  </>;
}

