"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Scan, ChevronDown } from "lucide-react";
import { IMAGE_RATIOS, IMAGE_RESOLUTIONS, imageSizeChoice, resolveImageSize } from "@/lib/studio/image-size";
import "./image-size-picker.css";

export default function ImageSizePicker({ value, onChange, zh, disabled = false, source, label }) {
  const [open, setOpen] = useState(false), [position, setPosition] = useState(null), [portalHost, setPortalHost] = useState(null);
  const trigger = useRef(null), panel = useRef(null), id = useId();
  const choice = imageSizeChoice(value), expanded = open && !disabled;
  const positioned = Boolean(position);
  const title = label || (zh ? "图片比例" : "Aspect ratio");
  const ratioLabel = choice.ratio === "auto" ? zh ? "智能" : "Auto" : choice.ratio;
  const dimensions = resolveImageSize(value, source);
  useLayoutEffect(() => {
    if (!expanded) return;
    const place = () => {
      const rect = trigger.current.getBoundingClientRect(), width = Math.min(296, innerWidth - 24);
      const above = rect.top - 12, below = innerHeight - rect.bottom - 12, up = above > below;
      setPosition({ width, left: Math.max(12, Math.min(rect.left, innerWidth - width - 12)), maxHeight: Math.max(140, Math.min(600, up ? above : below)), ...(up ? { bottom: innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }) });
    };
    place(); window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [expanded]);
  useEffect(() => {
    if (!expanded) return;
    const dismiss = event => { if (!panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false); };
    const escape = event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", dismiss); document.addEventListener("focusin", dismiss); document.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("focusin", dismiss); document.removeEventListener("keydown", escape, true); };
  }, [expanded]);
  useEffect(() => { if (expanded && positioned) panel.current?.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true }); }, [expanded, positioned]);
  return <><button ref={trigger} type="button" className="isp-trigger" aria-label={title} aria-haspopup="dialog" aria-expanded={expanded} aria-controls={expanded ? id : undefined} disabled={disabled} onClick={event => { setPortalHost(event.currentTarget.closest("dialog") || document.body); setOpen(v => !v); }}><span>{ratioLabel}</span><i />{choice.resolution}<ChevronDown size={12} /></button>
    {expanded && position && portalHost && createPortal(<div id={id} ref={panel} role="dialog" aria-label={zh ? "比例与分辨率" : "Ratio and resolution"} className="isp-panel" style={position}>
      <header>{zh ? "比例" : "Ratio"}</header><div className="isp-ratios" role="group" aria-label={zh ? "选择比例" : "Choose ratio"}>{IMAGE_RATIOS.map(ratio => {
        const [w, h] = ratio === "auto" ? [1, 1] : ratio.split(":").map(Number), factor = 16 / Math.max(w, h);
        return <button type="button" key={ratio} aria-pressed={choice.ratio === ratio} onClick={() => onChange(`${ratio}@${choice.resolution}`)}>{ratio === "auto" ? <Scan size={17} /> : <span className="isp-shape-wrap"><span className="isp-shape" style={{ width: Math.max(3, w * factor), height: Math.max(3, h * factor) }} /></span>}<span>{ratio === "auto" ? zh ? "智能" : "Auto" : ratio}</span></button>;
      })}</div><header>{zh ? "分辨率" : "Resolution"}</header><div className="isp-resolutions" role="group" aria-label={zh ? "选择分辨率" : "Choose resolution"}>{IMAGE_RESOLUTIONS.map(resolution => <button type="button" key={resolution} aria-pressed={choice.resolution === resolution} onClick={() => onChange(`${choice.ratio}@${resolution}`)}>{resolution}</button>)}</div>
      <footer><span>{dimensions.replace("x", " × ")} px</span><button type="button" onClick={() => { setOpen(false); trigger.current?.focus(); }}>{zh ? "完成" : "Done"}</button></footer><p>{choice.ratio === "auto" ? zh ? "智能跟随参考原图比例，无参考图时使用 1:1。" : "Auto follows the source ratio; without a reference it uses 1:1." : zh ? "实际可用尺寸取决于所选模型。" : "Available output sizes depend on the selected model."} {zh ? "K 表示像素档位，以上方尺寸为准。" : "K denotes pixel budget; exact dimensions are shown above."}</p>
    </div>, portalHost)}</>;
}
