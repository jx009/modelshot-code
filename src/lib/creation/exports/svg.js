import { layoutDocumentSchema } from "../contracts/layout.js";
import { EXPORT_MAX_BYTES, hasExportSignature } from "../contracts/exports.js";
import { imageFrame } from "../layout-rendering.js";
import { checkPosterImagePixels } from "./raster-policy.js";

const xml = value => String(value).toWellFormed().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]);
const fail = code => { throw new Error(code); };
export function validatePosterSvg(input) {
  const parsed = layoutDocumentSchema.safeParse(input);
  if (!parsed.success) fail("EXPORT_LAYOUT_INVALID");
  if (parsed.data.kind !== "poster") fail("EXPORT_KIND_UNSUPPORTED");
  return parsed.data;
}

// Serialize only schema-validated objects, never supplied SVG/HTML. Images must
// already be decoded/re-encoded by the credential-free conversion child.
// There are no scripts, stylesheets, foreignObject, user IDs or external URLs.
export function buildPosterSvg(input, images = new Map(), { layoutText, maxBytes = EXPORT_MAX_BYTES } = {}) {
  const document = validatePosterSvg(input), page = document.pages[0];
  checkPosterImagePixels(images);
  const limit = Math.min(maxBytes, EXPORT_MAX_BYTES);
  if (!Number.isSafeInteger(limit) || limit <= 0) fail("EXPORT_RESULT_TOO_LARGE");
  const parts = [], media = new Map(); let size = 0;
  const add = value => {
    size += Buffer.byteLength(value);
    if (size > limit) fail("EXPORT_RESULT_TOO_LARGE");
    parts.push(value);
  };
  add(`<svg xmlns="http://www.w3.org/2000/svg" width="${page.width}" height="${page.height}" viewBox="0 0 ${page.width} ${page.height}"><title>${xml(document.title)}</title><defs><clipPath id="page"><rect width="${page.width}" height="${page.height}"/></clipPath>`);
  for (const node of page.nodes) {
    if (!node.visible || node.type !== "image" || media.has(node.assetId)) continue;
    const source = images.get(node.assetId);
    if (!source) fail("EXPORT_IMAGE_MISSING");
    if (!["png", "jpeg"].includes(source.format) || !Buffer.isBuffer(source.bytes) || !hasExportSignature(source.bytes, source.format)) fail("EXPORT_IMAGE_UNSUPPORTED");
    // Check expansion before allocating a base64 string. Reused images are
    // defined once and referenced locally regardless of their instance count.
    if (size + 4 * Math.ceil(source.bytes.length / 3) + 256 > limit) fail("EXPORT_RESULT_TOO_LARGE");
    const id = `image${media.size}`; media.set(node.assetId, { ...source, id });
    add(`<image id="${id}" width="${source.width}" height="${source.height}" href="data:image/${source.format};base64,${source.bytes.toString("base64")}"/>`);
  }
  add(`</defs><g clip-path="url(#page)"><rect width="${page.width}" height="${page.height}" fill="${page.background}"/>`);
  for (const [index, node] of page.nodes.entries()) {
    if (!node.visible) continue;
    add(`<g transform="translate(${node.x} ${node.y}) rotate(${node.rotation})" opacity="${node.opacity}"><title>${xml(node.name)}</title>`);
    if (node.type === "text") {
      if (typeof layoutText !== "function") fail("EXPORT_FONTS_UNAVAILABLE");
      const measured = layoutText(node), style = node.style;
      if (!measured || typeof measured.fontFamily !== "string" || !Array.isArray(measured.lines) || measured.lines.length > 16000) fail("EXPORT_TEXT_LAYOUT_INVALID");
      add(`<text xml:space="preserve" font-family="${xml(measured.fontFamily)}" font-size="${style.fontSize}" font-weight="${style.fontWeight}" font-style="${style.fontStyle}" letter-spacing="${style.letterSpacing}" fill="${style.fill}"${style.letterSpacing ? ' font-kerning="none"' : ""}>`);
      for (const line of measured.lines) {
        if (typeof line.text !== "string" || line.text.length > 16000 || !Number.isFinite(line.x) || !Number.isFinite(line.y)) fail("EXPORT_TEXT_LAYOUT_INVALID");
        add(`<tspan x="${line.x}" y="${line.y}">${xml(line.text)}</tspan>`);
      }
      add("</text>");
    } else if (node.type === "shape") {
      const paint = `fill="${node.fill}" stroke="${node.stroke}" stroke-width="${node.strokeWidth}"`;
      if (node.shape === "ellipse") add(`<ellipse cx="${node.width / 2}" cy="${node.height / 2}" rx="${node.width / 2}" ry="${node.height / 2}" ${paint}/>`);
      else if (node.shape === "line") add(`<line x1="0" y1="0" x2="${node.width}" y2="${node.height}" stroke="${node.strokeWidth ? node.stroke : node.fill}" stroke-width="${node.strokeWidth || 2}"/>`);
      else { const radius = Math.min(node.radius, node.width / 2, node.height / 2); add(`<rect width="${node.width}" height="${node.height}" rx="${radius}" ry="${radius}" ${paint}/>`); }
    } else {
      const source = media.get(node.assetId), frame = imageFrame(source, node), clip = `clip${index}`;
      add(`<clipPath id="${clip}"><rect width="${node.width}" height="${node.height}"/></clipPath><g clip-path="url(#${clip})"><rect width="${node.width}" height="${node.height}" fill="#e7e7e7"/><use href="#${source.id}" transform="translate(${frame.x} ${frame.y}) scale(${frame.width / source.width} ${frame.height / source.height})"/>${node.alt ? `<desc>${xml(node.alt)}</desc>` : ""}</g>`);
    }
    add("</g>");
  }
  add("</g></svg>");
  return Buffer.from(parts.join(""));
}
