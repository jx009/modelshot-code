/** Fit rotated artwork (and optional expansion) above the measured tool card. */
export function editorCamera(layer, area, padding) {
  const edges = padding == null ? { left: 0, top: 0, right: 0, bottom: 0 }
    : typeof padding === "number" ? { left: padding, top: padding, right: padding, bottom: padding } : padding;
  const sx = layer.width / (layer.pixelWidth || layer.width), sy = layer.height / (layer.pixelHeight || layer.height);
  const angle = (layer.rotation || 0) * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  const left = -edges.left * sx, top = -edges.top * sy;
  const right = layer.width + edges.right * sx, bottom = layer.height + edges.bottom * sy;
  const corners = [[left, top], [right, top], [right, bottom], [left, bottom]].map(([x, y]) => ({ x: layer.x + x * cos - y * sin, y: layer.y + x * sin + y * cos }));
  const x = Math.min(...corners.map(p => p.x)), y = Math.min(...corners.map(p => p.y));
  const width = Math.max(...corners.map(p => p.x)) - x, height = Math.max(...corners.map(p => p.y)) - y;
  const scale = Math.min(2, area.width / Math.max(1, width), area.height / Math.max(1, height));
  return { scale, x: area.left + area.width / 2 - (x + width / 2) * scale, y: area.top + area.height / 2 - (y + height / 2) * scale };
}
