// Only the credential-free export child loads this module. The runtime is
// installed in the dedicated export image, never in the Web/browser packages.
import Konva from "konva/skia-backend";
import "konva";
import { Canvas, FontLibrary, loadImage } from "skia-canvas";
import { imageFrame, layoutTextProps, layoutShapeProps } from "../layout-rendering.js";
import { EXPORT_MAX_BYTES } from "../contracts/exports.js";
import { validatePosterExport, checkPosterImagePixels } from "./raster-policy.js";
import { validateLayoutPdf, pdfPageSize, PDF_POINTS_PER_PIXEL } from "./pdf-policy.js";

const fonts = { sans: '"Noto Sans", "Noto Sans CJK SC"', serif: '"Noto Serif", "Noto Serif CJK SC"', mono: '"Noto Sans Mono", "Noto Sans CJK SC"' };
const requiredFonts = ["Noto Sans", "Noto Sans CJK SC", "Noto Serif", "Noto Serif CJK SC", "Noto Sans Mono"];
const createCanvas = Konva.Util.createCanvasElement;
Konva.Util.createCanvasElement = () => { const canvas = createCanvas(); canvas.gpu = false; return canvas; };
Konva.pixelRatio = 1;
Konva.autoDrawEnabled = false;

// SVG retains text runs, with wrapping/vertical placement measured using the
// same pinned Konva/Noto backend as PNG. No full-size raster surface is made.
export function measureSvgText(node) {
  const text = new Konva.Text({ ...layoutTextProps(node), fontFamily: fonts[node.style.fontFamily] });
  try {
    const metrics = text.measureSize("M"), lineHeight = node.style.lineHeight * node.style.fontSize;
    const baseline = ((metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent) - (metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent)) / 2;
    const free = node.height - text.textArr.length * lineHeight;
    const top = node.style.verticalAlign === "middle" ? free / 2 : node.style.verticalAlign === "bottom" ? free : 0;
    return { fontFamily: fonts[node.style.fontFamily], lines: text.textArr.map((line, index) => ({ text: line.text,
      x: node.style.align === "center" ? (node.width - line.width) / 2 : node.style.align === "right" ? node.width - line.width : 0,
      y: top + lineHeight / 2 + baseline + index * lineHeight,
    })) };
  } finally { text.destroy(); }
}

export async function probeRasterBackend() {
  if (requiredFonts.some(font => !FontLibrary.has(font))) throw new Error("EXPORT_FONTS_UNAVAILABLE");
  const canvas = Konva.Util.createCanvasElement();
  try {
    canvas.width = 8; canvas.height = 8;
    const context = canvas.getContext("2d"); context.fillStyle = "#112233"; context.fillRect(0, 0, 8, 8);
    // Exercise the native CPU rasterizer/encoder as well as module resolution.
    await canvas.toBuffer("png"); await canvas.toBuffer("jpeg");
  } finally { canvas.dispose(); }
}

export async function buildPosterRaster(input, images, format) {
  const { page, width, height } = validatePosterExport(input, format);
  checkPosterImagePixels(images);
  const decoded = new Map(); let group, canvas;
  try {
    group = await createPageScene(page, images, decoded);
    // No Stage, hit-test canvas, thumbnail tree or browser screenshot is created.
    canvas = group.toCanvas({ x: 0, y: 0, width, height, pixelRatio: 1 });
    const bytes = await canvas.toBuffer(format, format === "jpeg" ? { quality: .9, matte: "white" } : {});
    if (bytes.length > EXPORT_MAX_BYTES) throw new Error("EXPORT_RESULT_TOO_LARGE");
    return bytes;
  } finally {
    group?.destroy(); canvas?.dispose();
    for (const image of decoded.values()) image.dispose();
  }
}

async function createPageScene(page, images, decoded) {
  const group = new Konva.Group({ listening: false, clipWidth: page.width, clipHeight: page.height });
  try {
    group.add(new Konva.Rect({ width: page.width, height: page.height, fill: page.background, listening: false }));
    for (const node of page.nodes) {
      if (!node.visible) continue;
      const item = new Konva.Group({ x: node.x, y: node.y, rotation: node.rotation, opacity: node.opacity, listening: false });
      group.add(item);
      if (node.type === "text") item.add(new Konva.Text({ ...layoutTextProps(node), fontFamily: fonts[node.style.fontFamily] }));
      else if (node.type === "shape") {
        const Shape = node.shape === "ellipse" ? Konva.Ellipse : node.shape === "line" ? Konva.Line : Konva.Rect;
        item.add(new Shape(layoutShapeProps(node)));
      } else {
        let image = decoded.get(node.assetId);
        if (!image) {
          const source = images.get(node.assetId);
          if (!source) throw new Error("EXPORT_IMAGE_MISSING");
          image = await loadImage(source.bytes); decoded.set(node.assetId, image);
        }
        // Match the editor's image frame, including its neutral contain backdrop.
        item.clipWidth(node.width); item.clipHeight(node.height);
        item.add(new Konva.Rect({ width: node.width, height: node.height, fill: "#e7e7e7", listening: false }));
        item.add(new Konva.Image({ image, ...imageFrame(image, node), listening: false }));
      }
    }
    return group;
  } catch (error) { group.destroy(); throw error; }
}

// Skia records drawing operations until encoding. drawCanvas (unlike drawImage)
// transfers a page's vector picture, so text/shapes are not flattened to PNG.
// Only one Konva scene exists at a time; native PDF pictures remain bounded by
// pdf-policy and the isolated process's OS limits until final serialization.
export async function buildLayoutPdf(input, images) {
  const { pages } = validateLayoutPdf(input);
  checkPosterImagePixels(images);
  const decoded = new Map(), scale = PDF_POINTS_PER_PIXEL;
  const pdf = new Canvas(...pdfPageSize(pages[0]), { gpu: false });
  try {
    for (const [index, page] of pages.entries()) {
      const context = index ? pdf.newPage(...pdfPageSize(page)) : pdf.getContext("2d");
      let group, picture;
      try {
        group = await createPageScene(page, images, decoded);
        picture = group.toCanvas({ x: 0, y: 0, width: Math.ceil(page.width), height: Math.ceil(page.height), pixelRatio: 1 });
        context.save(); context.scale(scale, scale);
        context.drawCanvas(picture, 0, 0); context.restore();
      } finally { group?.destroy(); picture?.dispose(); }
    }
    const bytes = await pdf.toBuffer("pdf");
    if (bytes.length > EXPORT_MAX_BYTES) throw new Error("EXPORT_RESULT_TOO_LARGE");
    return bytes;
  } finally { pdf.dispose(); for (const image of decoded.values()) image.dispose(); }
}

export async function probePdfBackend() {
  await probeRasterBackend();
  const canvas = new Canvas(96, 48, { gpu: false }), source = new Canvas(12, 12, { gpu: false });
  try {
    const context = canvas.getContext("2d"); context.font = '12px "Noto Sans CJK SC"'; context.fillText("中文 PDF", 2, 20);
    source.getContext("2d").fillRect(0, 0, 12, 12);
    canvas.newPage(48, 96).drawCanvas(source, 0, 0);
    const bytes = await canvas.toBuffer("pdf");
    if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("EXPORT_PDF_RUNTIME_UNAVAILABLE");
  } finally { canvas.dispose(); source.dispose(); }
}
