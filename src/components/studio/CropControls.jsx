"use client";
import { ratioCrop } from "@/lib/studio/crop-geometry";

export default function CropControls({ value, onChange, width, height, zh }) {
  const shape = value.cropShape || "rectangle", grid = value.cropGrid || { x: [.5], y: [.5] };
  const currentRatio = value.rect?.width && value.rect?.height ? value.rect.width / value.rect.height : width / height;
  const ratios = [["1:1", 1, "square"], ["4:3", 4 / 3, "landscape"], ["3:4", 3 / 4, "portrait"], ["16:9", 16 / 9, "wide"], ["9:16", 9 / 16, "tall"], [zh ? "原图" : "Original", width / height, "original"]];
  const shapes = [["rectangle", zh ? "方形" : "Rectangle", "square"], ["ellipse", zh ? "圆形" : "Ellipse", "circle"], ["triangle", zh ? "三角形" : "Triangle", "triangle"], ["heart", zh ? "心形" : "Heart", "heart"], ["grid", zh ? "宫格" : "Grid", "grid"]];
  const isOriginal = value.rect?.left === 0 && value.rect?.top === 0 && value.rect?.width === width && value.rect?.height === height;
  function selectedRatio(ratio, id) { return id === "original" ? isOriginal : !isOriginal && Math.abs(currentRatio - ratio) < .015; }
  function gridSize(axis, count) { onChange({ cropGrid: { ...grid, [axis]: Array.from({ length: count - 1 }, (_, i) => (i + 1) / count) } }); }
  return <div className="ms-crop-controls">
    <div className="ms-crop-section"><span className="ms-crop-section-title">{zh ? "比例" : "Ratio"}</span><div className="ms-crop-presets ms-crop-ratio-presets" role="group" aria-label={zh ? "裁剪比例" : "Crop ratio"}>{ratios.map(([label, ratio, id]) => <button key={id} type="button" className={`ms-crop-option ${selectedRatio(ratio, id) ? "active" : ""}`} aria-pressed={selectedRatio(ratio, id)} aria-label={label} onClick={() => onChange({ rect: id === "original" ? { left: 0, top: 0, width, height } : ratioCrop(width, height, ratio) })}><i className={`ms-crop-glyph ms-crop-glyph-${id}`} aria-hidden="true" /><span>{label}</span></button>)}</div></div>
    <div className="ms-crop-section"><span className="ms-crop-section-title">{zh ? "形状" : "Shape"}</span><div className="ms-crop-presets ms-crop-shape-presets" role="group" aria-label={zh ? "裁剪形状" : "Crop shape"}>{shapes.map(([id, label, glyph]) => <button type="button" key={id} className={`ms-crop-option ${shape === id ? "active" : ""}`} aria-pressed={shape === id} aria-label={label} onClick={() => onChange({ cropShape: id, ...(id === "grid" ? { cropGrid: grid } : { cropGrid: undefined }) })}><i className={`ms-crop-glyph ms-crop-glyph-${glyph}`} aria-hidden="true" /><span>{label}</span></button>)}</div></div>
    {shape === "grid" && <div className="ms-crop-grid-options"><div className="ms-crop-presets">{[2, 3, 4, 5].map(n => <button type="button" className="ms-crop-mini-option" key={n} aria-label={`${n} × ${n}`} onClick={() => onChange({ cropGrid: { x: Array.from({ length: n - 1 }, (_, i) => (i + 1) / n), y: Array.from({ length: n - 1 }, (_, i) => (i + 1) / n) } })}>{n}×{n}</button>)}</div><div className="ms-crop-grid-selects">{[["x", zh ? "列" : "Columns"], ["y", zh ? "行" : "Rows"]].map(([axis, label]) => <label key={axis}>{label}<select value={grid[axis].length + 1} aria-label={label} onChange={event => gridSize(axis, Number(event.target.value))}>{[1, 2, 3, 4, 5].map(n => <option value={n} key={n}>{n}</option>)}</select></label>)}</div><small>{zh ? "拖动交点调整分割线，每格生成一张独立图片" : "Drag intersections to adjust cuts. Each cell becomes a separate image."}</small></div>}
    <small className="ms-crop-size">{value.rect?.width || width} × {value.rect?.height || height} px</small>
  </div>;
}
