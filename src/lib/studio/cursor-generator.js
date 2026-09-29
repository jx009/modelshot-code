/**
 * Generate dynamic brush cursor based on size
 * @param {number} size - Brush size in pixels
 * @param {string} color - Cursor color (hex)
 * @returns {string} CSS cursor value
 */
export function generateBrushCursor(size, color = "#30ed19") {
  const diameter = Math.max(8, Math.min(128, size + 4));
  const center = diameter / 2;

  const svg = `
    <svg width="${diameter}" height="${diameter}" viewBox="0 0 ${diameter} ${diameter}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${center}" cy="${center}" r="${center - 2}" fill="none" stroke="${color}" stroke-width="1.5"/>
      <circle cx="${center}" cy="${center}" r="1" fill="${color}"/>
    </svg>
  `;

  const encoded = encodeURIComponent(svg);
  return `url('data:image/svg+xml;utf8,${encoded}') ${center} ${center}, crosshair`;
}

/**
 * Get cursor style for different canvas modes
 * @param {string} mode - Canvas mode
 * @param {number} brushSize - Brush size for brush mode
 * @returns {string} CSS cursor value
 */
export function getCursorForMode(mode, brushSize = 8, color = "#30ed19") {
  switch (mode) {
    case "hand":
      return "grab";
    case "mask":
      return generateBrushCursor(brushSize, color);
    case "crop":
    case "object-select-rect":
    case "object-select-lasso":
      return "crosshair";
    case "move":
    case "object-edit":
      return "move";
    default:
      return "default";
  }
}
