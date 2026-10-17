"use client";
import { Check, RotateCcw, SlidersHorizontal, X } from "lucide-react";
import { ADJUSTMENT_PRESETS } from "@/lib/studio/adjustments";
const fields = [["exposure", "曝光", "Exposure"], ["contrast", "对比度", "Contrast"], ["highlights", "高光", "Highlights"], ["shadows", "阴影", "Shadows"], ["temperature", "色温", "Temperature"], ["tint", "色调", "Tint"], ["saturation", "饱和度", "Saturation"], ["vibrance", "自然饱和度", "Vibrance"], ["fade", "褪色", "Fade"], ["vignette", "暗角", "Vignette"]];
export default function AdjustmentPanel({ value, onChange, zh, onApply, onClose, onCompare, busy = false }) {
  return <section className="ms-adjustment-panel" aria-label={zh ? "调色" : "Color adjustments"}>
    <header><SlidersHorizontal size={17} /><strong>{zh ? "调色" : "Color"}</strong><span>{zh ? "实时预览" : "Live preview"}</span><button disabled={busy} onClick={onClose} aria-label={zh ? "取消调色" : "Cancel adjustments"}><X size={18} /></button></header>
    <div className="ms-adjust-presets">{ADJUSTMENT_PRESETS.map(p => <button key={p.id} onClick={() => onChange(p.values)}>{zh ? p.zh : p.en}</button>)}</div>
    <div className="ms-adjust-fields">{fields.map(([key, cn, en]) => <label key={key}><span>{zh ? cn : en}</span><output>{value[key] || 0}</output><input aria-label={zh ? cn : en} type="range" min={["vignette", "fade"].includes(key) ? 0 : -100} max="100" value={value[key] || 0} onChange={e => onChange({ ...value, [key]: Number(e.target.value) })} /></label>)}</div>
    <footer><button disabled={busy} onClick={() => onChange({})} aria-label={zh ? "重置调色" : "Reset adjustments"}><RotateCcw size={15} /></button><button onPointerDown={() => onCompare(true)} onPointerUp={() => onCompare(false)} onPointerLeave={() => onCompare(false)} onBlur={() => onCompare(false)} onKeyDown={e => { if (e.key === " " || e.key === "Enter") onCompare(true); }} onKeyUp={() => onCompare(false)}>{zh ? "按住对比" : "Hold to compare"}</button><button className="ms-editor-apply" disabled={busy} onClick={onApply}><Check size={15} />{zh ? "应用" : "Apply"}</button></footer>
  </section>;
}
