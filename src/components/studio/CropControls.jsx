"use client";
import { ratioCrop } from "@/lib/studio/crop-geometry";

export default function CropControls({ value, onChange, width, height, zh }) {
  const shape = value.cropShape || "rectangle", grid = value.cropGrid || { x: [.5], y: [.5] };
  function gridSize(axis, count) { onChange({ cropGrid: { ...grid, [axis]: Array.from({ length: count - 1 }, (_, i) => (i + 1) / count) } }); }
  return <div className="ms-crop-controls">
    <div className="ms-crop-presets" role="group" aria-label={zh ? "裁剪比例" : "Crop ratio"}>{[["1:1", 1], ["4:3", 4 / 3], ["3:4", 3 / 4], ["16:9", 16 / 9], ["9:16", 9 / 16]].map(([label, ratio]) => <button key={label} className="ms-button" onClick={() => onChange({ rect: ratioCrop(width, height, ratio) })}>{label}</button>)}<button className="ms-button" onClick={() => onChange({ rect: { left: 0, top: 0, width, height } })}>{zh ? "原图" : "Original"}</button></div>
    <div className="ms-crop-presets" role="group" aria-label={zh ? "裁剪形状" : "Crop shape"}>{[["rectangle", "方形", "Rectangle"], ["ellipse", "圆形", "Ellipse"], ["triangle", "三角形", "Triangle"], ["heart", "心形", "Heart"], ["grid", "宫格", "Grid"]].map(([id, cn, en]) => <button key={id} className={`ms-button ${shape === id ? "active" : ""}`} aria-pressed={shape === id} onClick={() => onChange({ cropShape: id, ...(id === "grid" ? { cropGrid: grid } : { cropGrid: undefined }) })}>{zh ? cn : en}</button>)}</div>
    {shape === "grid" && <><div className="ms-crop-presets">{[2, 3, 4, 5].map(n => <button className="ms-button" key={n} onClick={() => onChange({ cropGrid: { x: Array.from({ length: n - 1 }, (_, i) => (i + 1) / n), y: Array.from({ length: n - 1 }, (_, i) => (i + 1) / n) } })}>{n}×{n}</button>)}</div><div className="ms-crop-presets">{[["x", "列数", "Columns"], ["y", "行数", "Rows"]].map(([axis, cn, en]) => <label key={axis}>{zh ? cn : en}<select value={grid[axis].length + 1} onChange={event => gridSize(axis, Number(event.target.value))}>{[1, 2, 3, 4, 5].map(n => <option value={n} key={n}>{n}</option>)}</select></label>)}</div><small>{zh ? "拖动交点调整分割线，每格生成一张独立图片" : "Drag intersections to adjust cuts. Each cell becomes a separate image."}</small></>}
    <small>{value.rect?.width || width} × {value.rect?.height || height} px</small>
  </div>;
}
