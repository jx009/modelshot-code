const numeric = (value, min, max) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : min;

export function NumberField({ label, value, min = -32768, max = 32768, step = "any", onChange, disabled }) {
  return <label>{label}<input type="number" value={Math.round(value * 100) / 100} disabled={disabled} min={min} max={max} step={step} onChange={event => onChange(numeric(event.target.value, min, max))} /></label>;
}

export function ColorField({ label, value, onChange, disabled, zh = true }) {
  const alpha = value.length === 9 ? Number.parseInt(value.slice(7), 16) : 255;
  return <div className="cw-field-grid">
    <label>{label}<input type="color" value={value.slice(0, 7)} disabled={disabled} onChange={event => onChange(event.target.value + (alpha === 255 ? "" : value.slice(7)))} /></label>
    <NumberField label={zh ? "不透明度 %" : "Opacity %"} value={alpha / 255 * 100} min={0} max={100} disabled={disabled}
      onChange={percent => onChange(value.slice(0, 7) + Math.round(percent / 100 * 255).toString(16).padStart(2, "0"))} />
  </div>;
}
