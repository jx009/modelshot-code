import { layoutDocumentSchema } from "../contracts/layout.js";

// Bounds retained vector commands as well as fallback bitmap surfaces. Limits
// are independent of compressed image/output sizes and apply before rendering.
export const PDF_MAX_PAGES = 100;
export const PDF_MAX_PAGE_PIXELS = 8_000_000;
export const PDF_MAX_TOTAL_PIXELS = 240_000_000;
export const PDF_MAX_TEXT_UNITS = 500_000;
export const PDF_POINTS_PER_PIXEL = 72 / 96;
// Skia 4's PDF encoder rounds page bounds up to integer points. Make the
// physical-size policy explicit; drawing coordinates keep the exact .75 scale.
export function pdfPageSize(page) { return [Math.ceil(page.width * PDF_POINTS_PER_PIXEL), Math.ceil(page.height * PDF_POINTS_PER_PIXEL)]; }

export function validateLayoutPdf(input) {
  const document = layoutDocumentSchema.parse(input);
  const pages = document.kind === "slides" ? document.pages.filter(page => !page.hidden) : document.pages;
  if (!pages.length) throw new Error("EXPORT_PDF_NO_VISIBLE_PAGES");
  if (pages.length > PDF_MAX_PAGES) throw new Error("EXPORT_PDF_BUDGET_EXCEEDED");
  let pixels = 0, text = 0;
  for (const page of pages) {
    const area = Math.ceil(page.width) * Math.ceil(page.height);
    pixels += area;
    text += page.nodes.reduce((sum, node) => sum + (node.visible && node.type === "text" ? node.text.length : 0), 0);
    if (area > PDF_MAX_PAGE_PIXELS || pixels > PDF_MAX_TOTAL_PIXELS || text > PDF_MAX_TEXT_UNITS) throw new Error("EXPORT_PDF_BUDGET_EXCEEDED");
  }
  return { document, pages };
}

export function pdfAssetIds(pages) {
  return [...new Set(pages.flatMap(page => page.nodes.filter(node => node.visible && node.type === "image").map(node => node.assetId)))];
}
