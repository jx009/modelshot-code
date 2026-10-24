// The editor, presentation and thumbnail renderer share these exact geometry
// and typography attributes. This module imports no UI or schema engine.
export const layoutFonts = Object.freeze({ sans: 'Arial, "Microsoft YaHei", sans-serif', serif: 'Georgia, "Noto Serif SC", serif', mono: 'Consolas, monospace' });

export function imageFrame(image, node) {
  const iw = image.naturalWidth || image.width, ih = image.naturalHeight || image.height;
  if (node.fit === "stretch") return { x: 0, y: 0, width: node.width, height: node.height };
  const scale = node.fit === "contain" ? Math.min(node.width / iw, node.height / ih) : Math.max(node.width / iw, node.height / ih);
  return { x: (node.width - iw * scale) / 2, y: (node.height - ih * scale) / 2, width: iw * scale, height: ih * scale };
}

export function layoutTextProps(node) {
  return { text: node.text, width: node.width, height: node.height, fontFamily: layoutFonts[node.style.fontFamily],
    fontSize: node.style.fontSize, fontStyle: `${node.style.fontWeight === "bold" ? "bold " : ""}${node.style.fontStyle}`.trim(),
    fill: node.style.fill, align: node.style.align, verticalAlign: node.style.verticalAlign,
    lineHeight: node.style.lineHeight, letterSpacing: node.style.letterSpacing, listening: false };
}

export function layoutShapeProps(node) {
  if (node.shape === "ellipse") return { x: node.width / 2, y: node.height / 2, radiusX: node.width / 2, radiusY: node.height / 2,
    fill: node.fill, stroke: node.stroke, strokeWidth: node.strokeWidth, listening: false };
  if (node.shape === "line") return { points: [0, 0, node.width, node.height], stroke: node.strokeWidth ? node.stroke : node.fill, strokeWidth: node.strokeWidth || 2, listening: false };
  return { width: node.width, height: node.height, cornerRadius: node.radius, fill: node.fill, stroke: node.stroke, strokeWidth: node.strokeWidth, listening: false };
}

export function presentationPages(content) { return content.pages.filter(page => !page.hidden); }
export function presentationStartIndex(pages, pageId) { return Math.max(0, pages.findIndex(page => page.id === pageId)); }
export function presentationKeyIndex(key, index, count) {
  if (!count) return null;
  if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(key)) return Math.min(count - 1, index + 1);
  if (["ArrowLeft", "ArrowUp", "PageUp"].includes(key)) return Math.max(0, index - 1);
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}
