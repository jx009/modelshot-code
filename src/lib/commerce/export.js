import { THEMES, outputWidth } from "./schema-client.js";

export function sectionGeometry(layout) {
  if (layout === "split") return { image: [420, 0, 580, 1150], copy: [55, 310, 320], titleSize: 62, bodyY: 555 };
  if (layout === "inset") return { image: [65, 345, 870, 720], copy: [65, 70, 850], titleSize: 66, bodyY: 240 };
  return { image: [0, 0, 1000, 1150], copy: [65, 75, 830], titleSize: 80, bodyY: 305 };
}
function loadImage(src) {
  return new Promise((resolve, reject) => { const img = new Image(); const timer = setTimeout(() => reject(new Error("IMAGE_LOAD_FAILED")), 20000); img.onload = () => { clearTimeout(timer); resolve(img); }; img.onerror = () => { clearTimeout(timer); reject(new Error("IMAGE_LOAD_FAILED")); }; img.src = src; });
}
function wrap(ctx, text, width) {
  const lines = []; let line = "";
  for (const letter of Array.from(text)) { if (letter === "\n" || ctx.measureText(line + letter).width > width) { lines.push(line); line = letter === "\n" ? "" : letter; } else line += letter; }
  if (line) lines.push(line); return lines;
}
function fitText(ctx, text, x, y, width, size, maxLines, color, maxHeight = Infinity, draw = true) {
  let lines;
  do { ctx.font = `${size}px "Microsoft YaHei", Arial, sans-serif`; lines = wrap(ctx, text, width); if (lines.length <= maxLines && lines.length * size * 1.4 <= maxHeight) break; size -= 2; } while (size >= 18);
  if (lines.length > maxLines || lines.length * size * 1.4 > maxHeight) throw new Error("TEXT_OVERFLOW");
  ctx.fillStyle = color; ctx.textBaseline = "top"; if (draw) lines.forEach((line, i) => ctx.fillText(line, x, y + i * size * 1.4));
  return { fontSize: size, lines };
}
export async function renderSection(section, brief, src, { noText = false } = {}) {
  const width = outputWidth(brief.platform), canvas = document.createElement("canvas"); canvas.width = width; canvas.height = Math.round(width * 1150 / 1000);
  const ctx = canvas.getContext("2d"), scale = width / 1000, theme = THEMES[brief.theme] || THEMES.linen, geometry = sectionGeometry(section.layout);
  ctx.scale(scale, scale); ctx.fillStyle = theme.background; ctx.fillRect(0, 0, 1000, 1150);
  const img = await loadImage(src), [x, y, w, h] = geometry.image, ratio = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.drawImage(img, x + (w - img.naturalWidth * ratio) / 2, y + (h - img.naturalHeight * ratio) / 2, img.naturalWidth * ratio, img.naturalHeight * ratio); ctx.restore();
  if (section.layout === "cover") { const gradient = ctx.createLinearGradient(0, 0, 0, 850); gradient.addColorStop(0, `${theme.background}fa`); gradient.addColorStop(.45, `${theme.background}ce`); gradient.addColorStop(1, `${theme.background}00`); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1000, 1000); }
  const [tx, ty, tw] = geometry.copy;
  const title = fitText(ctx, section.title, tx, ty + 62, tw, geometry.titleSize, 2, theme.text, geometry.bodyY - ty - 82, !noText);
  const body = fitText(ctx, section.body, tx, geometry.bodyY, tw, 27, section.layout === "split" ? 10 : 3, theme.muted, section.layout === "inset" ? 85 : section.layout === "cover" ? 145 : 390, !noText);
  if (!noText) { fitText(ctx, section.eyebrow, tx, ty, tw, 17, 2, theme.muted); fitText(ctx, brief.brand || "PRODUCT JOURNAL", 65, 1101, 650, 15, 1, theme.text); }
  return { canvas, geometry, title, body };
}
export const canvasBlob = (canvas, type = "image/png") => new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("EXPORT_FAILED")), type, .92));
export async function exportStory(commerce, imageFor, { original = false } = {}) {
  const { default: JSZip } = await import("jszip"), zip = new JSZip();
  const canvases = [];
  for (const [i, section] of commerce.sections.entries()) { const { canvas } = await renderSection(section, commerce.brief, imageFor(section)); canvases.push(canvas); zip.file(`${String(i + 1).padStart(2, "0")}-${section.kind}.jpg`, await canvasBlob(canvas, "image/jpeg")); }
  const full = document.createElement("canvas"); full.width = canvases[0].width; full.height = canvases.reduce((s, c) => s + c.height, 0);
  if (full.height > 16000 || full.width * full.height > 40000000) throw new Error("EXPORT_TOO_LARGE");
  let y = 0; const ctx = full.getContext("2d"); for (const c of canvases) { ctx.drawImage(c, 0, y); y += c.height; }
  zip.file("detail-page.png", await canvasBlob(full));
  zip.file("project.json", JSON.stringify({ ...commerce, source: original ? "original-photo-layout" : "generated-images-layout", exportedAt: new Date().toISOString() }, null, 2));
  return zip.generateAsync({ type: "blob" });
}
export function downloadBlob(blob, name) { const href = URL.createObjectURL(blob), a = document.createElement("a"); a.href = href; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(href), 30000); }
