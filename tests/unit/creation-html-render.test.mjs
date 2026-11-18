import { it, expect } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import JSZip from "jszip";
import { chartSvg } from "../../src/lib/creation/html/chart.js";
import { htmlDocumentSchema } from "../../src/lib/creation/html/document.js";
import { renderLayoutInProcess } from "../../src/lib/domain/creation/export-process.js";
import { hasExportSignature } from "../../src/lib/creation/contracts/exports.js";

it.skipIf(process.env.CREATION_HTML_RENDER_TESTS !== "true")("renders HTML typography and multipage PDF through the actual isolated child", async () => {
  const doc = htmlDocumentSchema.parse({ schemaVersion: 3, format: "html-poster", kind: "poster", title: "HTML 导出验证", theme: { name: "Test", primary: "#123456", accent: "#ddaa66", background: "#ffffff", fontFamily: "sans" }, pages: [{ id: "one", title: "One", width: 640, height: 480, html: '<!DOCTYPE html><html><head><style>body{margin:0;background:#f7f0df;color:#234b3b;font-family:Arial,sans-serif;padding:30px;box-sizing:border-box;width:640px;height:480px}h1{font-size:54px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.tile{background:#d9a66b;padding:20px;border-radius:20px}</style></head><body><h1 data-node-id="title">自由排版 · HTML</h1><div class="grid" data-node-id="grid"><p class="tile" data-node-id="left">中文字体 / 可编辑文字</p><p class="tile" data-node-id="right">2026 / COFFEE</p></div></body></html>' }] });
  const outputDir = process.env.CREATION_HTML_TEST_OUTPUT_DIR;
  if (outputDir) await mkdir(outputDir, { recursive: true });
  const render = (content, format) => renderLayoutInProcess(content, [], { store: {}, signal: AbortSignal.timeout(60000), format, exporterVersion: `html-${format}-1` });
  const png = await render(doc, "png");
  expect(await sharp(png).metadata()).toMatchObject({ width: 640, height: 480, format: "png" });
  const stats = await sharp(png).stats(); expect(stats.entropy).toBeGreaterThan(0.1);
  const pdf = await render(doc, "pdf"); expect(hasExportSignature(pdf, "pdf")).toBe(true);
  const slides = { ...doc, kind: "slides", format: "html-slides", pages: [doc.pages[0], { ...doc.pages[0], id: "two", html: doc.pages[0].html.replace("自由排版", "第二页面") }] };
  const deck = await render(slides, "pdf"); expect(hasExportSignature(deck, "pdf")).toBe(true);
  if (outputDir) { await writeFile(join(outputDir, "html-poster.png"), png); await writeFile(join(outputDir, "html-poster.pdf"), pdf); await writeFile(join(outputDir, "html-slides.pdf"), deck); }
}, 120000);

it.skipIf(process.env.CREATION_HTML_RENDER_TESTS !== "true")("exports HTML text, merged tables and charts as editable PPTX objects", async () => {
  const chart = { type: "bar", title: "销售额", labels: ["一月", "二月"], series: [{ name: "销售额", values: [12, 24], color: "#336699" }] };
  const html = `<!DOCTYPE html><html><head><style>body{margin:0;width:1280px;height:720px;background:#fff;font-family:Arial}h1{position:absolute;left:40px;top:20px;font-size:36px}table{position:absolute;left:40px;top:140px;width:450px;border-collapse:collapse}td{padding:15px;border:1px solid #999}#chart{position:absolute;left:580px;top:140px;width:640px;height:360px}</style></head><body><h1 data-node-id="title">可编辑中文图表</h1><table data-node-id="table"><tr><td colspan="2">合并单元格</td></tr><tr><td>一月</td><td>12</td></tr></table><div id="chart" data-node-id="chart" data-chart='${JSON.stringify(chart)}'>${chartSvg(chart)}</div><svg data-node-id="vector" width="40" height="40"><circle cx="20" cy="20" r="10" fill="#336699"/></svg></body></html>`;
  const doc = htmlDocumentSchema.parse({ schemaVersion: 3, format: "html-slides", kind: "slides", title: "HTML PPTX", theme: { name: "Test", primary: "#123456", accent: "#ddaa66", background: "#ffffff", fontFamily: "sans" }, pages: [{ id: "one", width: 1280, height: 720, html }] });
  const bytes = await renderLayoutInProcess(doc, [], { store: {}, signal: AbortSignal.timeout(60000), format: "pptx", exporterVersion: "html-pptx-1" });
  const zip = await JSZip.loadAsync(bytes), slide = await zip.file("ppt/slides/slide1.xml").async("string");
  expect(slide).toContain("可编辑中文图表"); expect(slide).toContain("<a:tbl>"); expect(slide).toContain('gridSpan="2"'); expect(slide).toContain("<c:chart");
  const chartXml = await zip.file("ppt/charts/chart1.xml").async("string"); expect(chartXml).toContain("<c:barChart>"); expect(chartXml).toContain("Sheet1!$B$2:$B$3");
  const data = await JSZip.loadAsync(await zip.file("ppt/embeddings/chart1.xlsx").async("nodebuffer")); expect(await data.file("xl/worksheets/sheet1.xml").async("string")).toContain("二月");
  expect(await zip.file("docProps/custom.xml").async("string")).toContain("SVG_OBJECT_RASTERIZED");
  if (process.env.CREATION_HTML_TEST_OUTPUT_DIR) { await mkdir(process.env.CREATION_HTML_TEST_OUTPUT_DIR, { recursive: true }); await writeFile(join(process.env.CREATION_HTML_TEST_OUTPUT_DIR, "html-editable.pptx"), bytes); }
}, 90000);

it.skipIf(process.env.CREATION_HTML_RENDER_TESTS !== "true")("exports CSS backgrounds as in-place images and keeps the text above them editable", async () => {
  const html = `<!DOCTYPE html><html><head><style>body{margin:0;width:1280px;height:720px;font-family:Arial;background:linear-gradient(135deg,#0b1d3a,#123b5c)}#card{position:absolute;left:80px;top:120px;width:560px;height:360px;border-radius:24px;background:radial-gradient(circle at 30% 30%,#2f8fbf,#0b1d3a)}#title{position:absolute;left:120px;top:200px;margin:0;color:#ffffff;font-size:48px}</style></head><body><div id="card" data-node-id="card"></div><h1 id="title" data-node-id="title">背景上的标题</h1></body></html>`;
  const doc = htmlDocumentSchema.parse({ schemaVersion: 3, format: "html-slides", kind: "slides", title: "背景图导出", theme: { name: "Test", primary: "#123456", accent: "#ddaa66", background: "#ffffff", fontFamily: "sans" }, pages: [{ id: "bg", width: 1280, height: 720, html }] });
  const bytes = await renderLayoutInProcess(doc, [], { store: {}, signal: AbortSignal.timeout(60000), format: "pptx", exporterVersion: "html-pptx-1" });
  const zip = await JSZip.loadAsync(bytes), slide = await zip.file("ppt/slides/slide1.xml").async("string");
  expect(slide.split("背景上的标题").length - 1).toBe(1);
  expect((slide.match(/<p:pic>/g) || []).length).toBeGreaterThanOrEqual(2);
  expect(Object.keys(zip.files).filter(name => name.startsWith("ppt/media/")).length).toBeGreaterThanOrEqual(2);
  expect(await zip.file("docProps/custom.xml").async("string")).toContain("CSS_BACKGROUND_RASTERIZED");
  // 卡片背景单独成图，圆角外是透明的，不会带上页面背景。
  const card = await Promise.all(Object.keys(zip.files).filter(name => name.startsWith("ppt/media/") && !zip.files[name].dir).map(async name => sharp(await zip.file(name).async("nodebuffer"))));
  const cards = [];
  for (const image of card) { const meta = await image.metadata(); if (meta.width === 560) cards.push(image); }
  expect(cards).toHaveLength(1);
  const corner = await cards[0].ensureAlpha().extract({ left: 0, top: 0, width: 2, height: 2 }).raw().toBuffer();
  expect(corner[3]).toBe(0);
  if (process.env.CREATION_HTML_TEST_OUTPUT_DIR) { await mkdir(process.env.CREATION_HTML_TEST_OUTPUT_DIR, { recursive: true }); await writeFile(join(process.env.CREATION_HTML_TEST_OUTPUT_DIR, "html-background.pptx"), bytes); }
}, 90000);
