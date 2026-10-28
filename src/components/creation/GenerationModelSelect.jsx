"use client";
import "./generation-model-select.css";

export default function GenerationModelSelect({ models = [], value = "", onChange, disabled, zh, video = false }) {
  const label = video ? (zh ? "视频模型" : "Video model") : (zh ? "配图模型" : "Image model");
  return <label className="generation-model-select">{label}<select aria-label={label} value={value || ""} disabled={disabled || !models.length} onChange={event => onChange(event.target.value)}>
    <option value="">{zh ? "默认模型" : "Default model"}</option>
    {value && !models.some(model => model.id === value) && <option value={value}>{zh ? "所选模型暂不可用" : "Selected model unavailable"}</option>}
    {models.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
  </select></label>;
}
