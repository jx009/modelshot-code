"use client";
import { useId } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import CreditIcon from "./CreditIcon";
import useAnchoredPanel from "./useAnchoredPanel";
import "./image-size-picker.css";

// 生成张数：用缩略版式直观展示一次出几张图，并显示对应积分。与比例选择器同一套面板样式。
export default function CountPicker({ value, onChange, options = [1, 2, 3, 4], unitCost, zh, disabled = false, label }) {
  const { expanded, position, host, trigger, panel, toggle, close } = useAnchoredPanel({ width: 264, disabled });
  const id = useId(), unit = zh ? "张" : "";
  return <><button ref={trigger} type="button" className="isp-trigger cnt-trigger" aria-label={label || (zh ? "生成张数" : "Image count")} aria-haspopup="dialog" aria-expanded={expanded} aria-controls={expanded ? id : undefined} disabled={disabled} onClick={toggle}>
    <span className={`cnt-preview n${value}`} aria-hidden="true">{options.slice(0, value).map(n => <i key={n} />)}</span>{value}{zh ? " 张" : "×"}<ChevronDown size={12} />
  </button>
    {expanded && position && host && createPortal(<div id={id} ref={panel} role="dialog" aria-label={zh ? "生成张数" : "Image count"} className="isp-panel cnt-panel" style={position}>
      <header>{zh ? "一次生成几张" : "Images per run"}</header>
      <div className="cnt-options" role="group" aria-label={zh ? "选择张数" : "Choose count"}>{options.map(count => <button type="button" key={count} aria-label={zh ? `${count} 张` : `${count}×`} aria-pressed={value === count} onClick={() => { onChange(count); close(); }}>
        <span className={`cnt-preview n${count}`} aria-hidden="true">{Array.from({ length: count }, (_, index) => <i key={index} />)}</span>
        <strong>{count}{unit && ` ${unit}`}{!unit && "×"}</strong>
        {Number.isFinite(unitCost) && <small><CreditIcon size={10} />{unitCost * count}</small>}
      </button>)}</div>
      <p>{zh ? "多张会同时生成，按实际张数扣积分；失败的张数自动退回。" : "Images are generated together and billed per image; failed images are refunded."}</p>
    </div>, host)}</>;
}
