import { chromium } from "playwright-core";
import { htmlDocumentSchema } from "../html/document.js";
import { projectHtml } from "../html/projection.js";
import { inspectHtml, attr } from "../html/document.js";
import { measureHtmlSlide } from "./html-measure.js";
import sharp from "sharp";

async function browserForExport() {
  return chromium.launch({ headless: true, timeout: 15000, args: ["--disable-dev-shm-usage", "--disable-background-networking", "--disable-extensions"] });
}
export async function probeHtmlBackend() {
  const browser = await browserForExport();
  try { const page = await browser.newPage(); await page.setContent("<p>中文 HTML</p>"); await page.pdf(); }
  finally { await browser.close(); }
}
export async function renderHtmlArtifact(input, assets, format) {
  const document = htmlDocumentSchema.parse(input), pages = format === "pptx" ? document.pages : document.pages.filter(page => !page.hidden);
  if (!pages.length || !["png", "jpeg", "pdf", "pptx"].includes(format) || !["pdf", "pptx"].includes(format) && pages.length !== 1) throw new Error("EXPORT_KIND_UNSUPPORTED");
  const images = new Map([...assets].map(([id, image]) => [id, `data:image/${image.format};base64,${image.bytes.toString("base64")}`]));
  const browser = await browserForExport();
  try {
    const context = await browser.newContext({ serviceWorkers: "block", offline: true });
    await context.route("**/*", route => route.abort());
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const first = pages[0], width = first.width;
    let height = first.height === "auto" ? 720 : first.height;
    if (pages.some(p => p.width !== width || p.height !== first.height)) throw new Error("EXPORT_MIXED_PAGE_SIZE_UNSUPPORTED");
    await page.setViewportSize({ width, height });
    if (format === "pptx") {
      if (pages.some(p => p.height === "auto")) throw new Error("EXPORT_MIXED_PAGE_SIZE_UNSUPPORTED");
      const measured = [], media = new Map(assets);
      for (const source of pages) {
        await page.setContent(projectHtml(source, images, { theme: document.theme, master: document.masters?.find(m => m.id === source.masterId) }), { waitUntil: "load" });
        await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode())); });
        const bindings = [...inspectHtml(source.html).ids].filter(([, node]) => node.tagName === "img").map(([id, node]) => [id, attr(node, "src")?.slice(6)]);
        await page.evaluate(bindings => { for (const [id, assetId] of bindings) document.querySelector(`[data-node-id="${CSS.escape(id)}"]`)?.setAttribute("data-export-asset", assetId); }, bindings);
        const output = await page.evaluate(measureHtmlSlide);
        for (const [index, vector] of output.raster.entries()) {
          if (!vector.selector) throw new Error("EXPORT_HTML_VECTOR_ID_REQUIRED");
          const bytes = await page.locator(`[data-node-id="${vector.selector}"]`).screenshot({ type: "png" }), assetId = `html-vector-${source.id}-${index}`;
          const meta = await sharp(bytes).metadata(); media.set(assetId, { bytes, format: "png", width: meta.width, height: meta.height });
          const { selector: _selector, ...geometry } = vector;
          output.nodes.push({ ...geometry, type: "image", assetId, fit: "contain", alt: vector.name });
        }
        measured.push(output);
      }
      const { buildMeasuredHtmlPptx } = await import("./html-pptx.js");
      return await buildMeasuredHtmlPptx(document, measured, media);
    }
    if (pages.length === 1) {
      await page.setContent(projectHtml(first, images, { theme: document.theme, master: document.masters?.find(m => m.id === first.masterId) }), { waitUntil: "load" });
      await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode())); });
      if (first.height === "auto") height = await page.evaluate(() => Math.ceil(Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)));
      if (height > 8192 || width * height > 40_000_000) throw new Error("EXPORT_CANVAS_TOO_LARGE");
      await page.setViewportSize({ width, height });
      if (format !== "pdf") return Buffer.from(await page.screenshot({ type: format, ...(format === "jpeg" ? { quality: 95 } : {}), clip: { x: 0, y: 0, width, height }, animations: "disabled" }));
    } else {
      const escape = value => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
      const frames = pages.map(p => `<iframe sandbox="allow-same-origin" srcdoc="${escape(projectHtml(p, images, { theme: document.theme, master: document.masters?.find(m => m.id === p.masterId) }))}"></iframe>`).join("");
      await page.setContent(`<html><head><style>html,body{margin:0}iframe{display:block;border:0;width:${width}px;height:${height}px;break-after:page}iframe:last-child{break-after:auto}</style></head><body>${frames}</body></html>`);
      for (const frame of page.frames().slice(1)) await frame.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode())); });
    }
    return Buffer.from(await page.pdf({ width: `${width}px`, height: `${height}px`, printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } }));
  } finally { await browser.close(); }
}
