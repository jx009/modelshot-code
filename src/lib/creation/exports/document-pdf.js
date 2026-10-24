import { Canvas, loadImage } from "skia-canvas";
import { EXPORT_MAX_BYTES } from "../contracts/exports.js";
import { checkPosterImagePixels } from "./raster-policy.js";
import { documentPdfModel } from "./document-pdf-model.js";
import { layoutDocumentPdf } from "./document-pdf-layout.js";

const families = { sans: '"Noto Sans", "Noto Sans CJK SC"', serif: '"Noto Serif", "Noto Serif CJK SC"', mono: '"Noto Sans Mono", "Noto Sans CJK SC"' };
const font = style => `${style.italic ? "italic " : ""}${style.bold ? "bold " : ""}${style.size}px ${families[style.family]}`;

export async function buildDocumentPdf(input, images = new Map()) {
  const model = documentPdfModel(input);
  checkPosterImagePixels(images);
  const canvas = new Canvas(model.page.width, model.page.height, { gpu: false }), decoded = new Map();
  try {
    const measureContext = canvas.getContext("2d"), cache = new Map();
    const pages = layoutDocumentPdf(model, (text, style) => {
      const f = font(style), key = `${f}\n${text}`;
      if (cache.has(key)) return cache.get(key);
      measureContext.font = f; const width = measureContext.measureText(text).width;
      if (cache.size < 10000) cache.set(key, width);
      return width;
    });
    for (const [index, page] of pages.entries()) {
      const context = index ? canvas.newPage(page.width, page.height) : canvas.getContext("2d");
      context.fillStyle = "#ffffff"; context.fillRect(0, 0, page.width, page.height);
      for (const command of page.commands) {
        const { x, y } = command;
        if (command.type === "cell") {
          if (command.background) { context.fillStyle = command.background; context.fillRect(x, y, command.width, command.height); }
          for (const [side, border] of Object.entries(command.borders)) {
            if (!border.width) continue;
            const endpoints = { Top: [x, y, x + command.width, y], Bottom: [x, y + command.height, x + command.width, y + command.height], Left: [x, y, x, y + command.height], Right: [x + command.width, y, x + command.width, y + command.height] }[side];
            context.strokeStyle = border.color; context.lineWidth = border.width; context.beginPath(); context.moveTo(...endpoints.slice(0, 2)); context.lineTo(...endpoints.slice(2)); context.stroke();
          }
          continue;
        }
        let left = x + command.indent + (command.align === "center" ? (command.available - command.width) / 2 : command.align === "right" ? command.available - command.width : 0);
        const gaps = command.parts.filter(part => part.type === "text" && /^\s+$/.test(part.text)).length;
        const extra = command.align === "justify" && !command.last && gaps ? (command.available - command.width) / gaps : 0;
        for (const part of command.parts) {
          if (part.type === "image") {
            let image = decoded.get(part.assetId);
            if (!image) {
              const source = images.get(part.assetId); if (!source) throw new Error("EXPORT_IMAGE_MISSING");
              image = await loadImage(source.bytes); decoded.set(part.assetId, image);
            }
            context.drawImage(image, left, y + command.height - part.height, part.width, part.height);
          } else {
            const s = part.style, text = part.type === "field" ? String(part.field === "PAGE" ? model.page.numberStart + index : pages.length) : part.text;
            const baseline = y + (command.height - s.size) / 2 + s.size * .8;
            context.font = font(s); context.textBaseline = "alphabetic";
            if (s.highlight) { context.fillStyle = s.highlight; context.fillRect(left, y, part.width, command.height); }
            context.fillStyle = s.color; context.fillText(text, left, baseline);
            for (const offset of [s.underline ? s.size * .12 : null, s.strike ? -s.size * .3 : null]) if (offset !== null) {
              context.strokeStyle = s.color; context.lineWidth = Math.max(.5, s.size / 16); context.beginPath(); context.moveTo(left, baseline + offset); context.lineTo(left + part.width, baseline + offset); context.stroke();
            }
          }
          left += part.width + (part.type === "text" && /^\s+$/.test(part.text) ? extra : 0);
        }
      }
    }
    const bytes = await canvas.toBuffer("pdf");
    if (bytes.length > EXPORT_MAX_BYTES) throw new Error("EXPORT_RESULT_TOO_LARGE");
    return bytes;
  } finally { canvas.dispose(); for (const image of decoded.values()) image.dispose(); }
}
