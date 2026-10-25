import { expect, it } from "vitest";
import { languageInputSchema, validateLanguageResult } from "../../src/lib/creation/contracts/language.js";
import { documentOutlineSchema } from "../../src/lib/creation/contracts/document-language.js";
import { outlineChildren } from "../../src/lib/creation/outline-plan.js";
import { assembleDocumentContent } from "../../src/lib/domain/creation/document-assembly.js";
import { posterImageStep } from "../../src/lib/creation/contracts/poster-image.js";
import { posterDesignContext } from "../../src/lib/creation/poster-design.js";
import { sheetOutlineSchema, sheetPlanSchema, validateSheetChunk } from "../../src/lib/creation/contracts/sheet-batch.js";
import { workbookSchema } from "../../src/lib/creation/contracts/sheet.js";
import { calculateWorkbook } from "../../src/lib/creation/sheet-calculation.js";
import { creationLanguageMessages } from "../../src/lib/domain/creation/language-provider.js";

it("shares aspect-aware poster composition with image and editable HTML prompts", () => {
  const input = languageInputSchema.parse({ purpose: "poster.generate", sourceFormat: "html", prompt: "Exact headline: 春日新品, price 29", width: 1080, height: 1440 });
  const messages = creationLanguageMessages({ input, assets: [] }), payload = JSON.parse(messages[1].content);
  expect(messages).toHaveLength(2);
  expect(payload.compositionGuide).toEqual(posterDesignContext(input));
  expect(payload.compositionGuide).toMatchObject({ orientation: "portrait", safeMargin: 59, headlineSize: 103, bodySize: 30 });
  expect(posterDesignContext({ width: 1600, height: 900 }).orientation).toBe("landscape");
  expect(posterDesignContext({ width: 1080, height: 1080 }).orientation).toBe("square");
  expect(messages[0].content).toContain("metadata.design");
  expect(messages[0].content).toContain("separate layers");
  const step = posterImageStep({ ...input, image: { size: "1024x1536" } });
  expect(step.params.prompt).toContain("portrait poster (1080 x 1440)");
  expect(step.params.prompt).toContain("春日新品");
  expect(posterImageStep({ ...input, prompt: "长".repeat(12000), image: { size: "1024x1536" } }).params.prompt.length).toBeLessThanOrEqual(4000);
});

it("carries approved document design into every section and the final editable document", () => {
  const outline = documentOutlineSchema.parse({ title: "运营报告", design: { purpose: "决策", tone: "简洁", narrative: "先结论后证据", terminology: "统一人民币口径", page: { size: "Letter", orientation: "landscape", marginLeft: 60 }, theme: { fontFamily: "serif", fontSize: 11, color: "#18202A" } }, sections: [{ id: "summary", title: "摘要", brief: "已提供的事实" }] });
  const run = { id: "run", kind: "document", input: {}, steps: [{ id: "outline", params: { purpose: "document.outline", prompt: "生成报告", sectionCount: 1 } }] };
  const steps = outlineChildren(run, outline, 2);
  expect(steps).toHaveLength(1);
  expect(steps[0].expectedCost).toBe(2);
  expect(steps[0].params.design).toEqual(outline.design);
  const section = { id: "summary", title: "摘要", blocks: [{ id: "p", type: "paragraph", runs: [{ text: "已核实的内容" }] }] };
  const content = assembleDocumentContent(outline, [section]);
  expect(content.page).toEqual(outline.design.page);
  expect(content.theme).toEqual(outline.design.theme);
  const legacy = { title: outline.title, sections: outline.sections };
  expect(assembleDocumentContent(legacy, [section]).page.size).toBe("A4");
  expect(outlineChildren(run, legacy, 2)[0].params.design).toBeUndefined();
});

it("preserves a bounded poster design brief in scoped AI edit context", () => {
  const design = { concept: "New launch", composition: "Asymmetric", typography: "Bold headline", imageTreatment: "Uncropped product" };
  const source = { schemaVersion: 3, format: "html-poster", kind: "poster", title: "Poster", metadata: { design }, theme: {}, pages: [{ id: "page", html: '<p data-node-id="title">Exact title</p>' }] };
  const input = languageInputSchema.parse({ purpose: "poster.edit", sourceFormat: "html", prompt: "修改标题颜色", artifactId: "poster", baseRevision: 1, pageId: "page", nodeIds: ["title"] });
  const messages = creationLanguageMessages({ input, source, assets: [] });
  expect(JSON.parse(messages[1].content).posterDesign).toEqual(design);
  expect(JSON.parse(messages[1].content).request.nodeIds).toEqual(["title"]);
  expect(messages[0].content).toContain("never expands the selected edit scope");
  source.metadata.design = { ...design, concept: "x".repeat(10000) };
  expect(JSON.parse(creationLanguageMessages({ input, source, assets: [] })[1].content).posterDesign).toBeUndefined();
});

const plan = () => ({ rowCount: 28, columnFormats: ["general", "currency"], rows: [{ startRow: 2, endRow: 27, brief: "按源文件顺序的 26 条记录" }], totals: [{ column: 2, operation: "SUM" }] });
const chunkInput = () => ({ purpose: "sheet.chunk", sheetId: "s", columns: ["编号", "金额"], locale: "zh", plan: plan(), startRow: 1, endRow: 25 });
it("rejects gaps, overlapping allocations, incompatible formats and plans over the row budget", () => {
  for (const rows of [[{ startRow: 3, endRow: 27, brief: "gap" }], [{ startRow: 2, endRow: 26, brief: "missing" }], [{ startRow: 2, endRow: 15, brief: "a" }, { startRow: 15, endRow: 27, brief: "overlap" }]]) expect(sheetPlanSchema.safeParse({ ...plan(), rows }).success).toBe(false);
  expect(sheetPlanSchema.safeParse({ ...plan(), totals: [{ column: 3, operation: "SUM" }] }).success).toBe(false);
  const outline = { title: "数据", sheets: [{ id: "s", name: "明细", columns: ["编号", "金额"], brief: "来源数据", plan: plan() }] };
  expect(sheetOutlineSchema.safeParse(outline).success).toBe(true);
  expect(sheetOutlineSchema.safeParse({ ...outline, sheets: [{ ...outline.sheets[0], columns: ["一列"] }] }).success).toBe(false);
  expect(() => validateLanguageResult({ purpose: "sheet.outline", sheetCount: 1, targetRows: 20 }, outline)).toThrow("LANGUAGE_SHEET_MISMATCH");
});

it("normalizes only headers, formats and final totals and replays chunks idempotently", () => {
  const first = chunkInput(), last = { ...first, startRow: 26, endRow: 28 };
  const start = validateSheetChunk(first, { sheetId: "s", cells: [{ id: "a", address: "A1", value: "wrong heading" }, { id: "b", address: "A2", value: "001" }, { id: "c", address: "B2", value: 12.5 }] });
  const end = validateSheetChunk(last, { sheetId: "s", cells: [{ id: "a", address: "A26", value: "025" }, { id: "b", address: "B26", value: 7.5 }, { id: "c", address: "B28", value: 999 }] });
  expect(start.cells.find(cell => cell.address === "A1")).toMatchObject({ value: "编号", style: { bold: true, background: "#222B45", color: "#FFFFFF" } });
  expect(start.cells.find(cell => cell.address === "A2").value).toBe("001");
  expect(start.cells.find(cell => cell.address === "B2")).toMatchObject({ value: 12.5, style: { numberFormat: "currency" } });
  expect(end.cells.find(cell => cell.address === "B28").formula).toBe('=IF(COUNT(B2:B27)=0,"",SUM(B2:B27))');
  expect(validateSheetChunk(first, JSON.parse(JSON.stringify(start)))).toEqual(start);
  expect(validateSheetChunk(last, JSON.parse(JSON.stringify(end)))).toEqual(end);
  const workbook = workbookSchema.parse({ schemaVersion: 1, kind: "sheet", title: "账表", sheets: [{ id: "s", name: "明细", cells: [...start.cells, ...end.cells] }] });
  const calculated = calculateWorkbook(workbook);
  expect(calculated.sheets[0].cells.find(cell => cell.address === "B28").calculated).toBe(20);
  const empty = { ...workbook, sheets: [{ ...workbook.sheets[0], cells: workbook.sheets[0].cells.filter(cell => cell.address !== "B2" && cell.address !== "B26") }] };
  expect(calculateWorkbook(empty).sheets[0].cells.find(cell => cell.address === "B28").calculated).toBe("");
  expect(workbook.sheets[0].cells.some(cell => cell.value === 999)).toBe(false);
});

it("allows a chunk containing only the deterministic total row without fabricated model data", () => {
  const input = { ...chunkInput(), startRow: 28, endRow: 28 };
  expect(validateSheetChunk(input, { sheetId: "s", cells: [] }).cells).toHaveLength(2);
  expect(() => validateSheetChunk({ ...input, startRow: 26, endRow: 27 }, { sheetId: "s", cells: [] })).toThrow("LANGUAGE_SHEET_CHUNK_MISMATCH");
});

const site = () => ({ schemaVersion: 1, kind: "web", title: "Studio", theme: { primary: "#111111", accent: "#E68040", background: "#FFFFFF", fontFamily: "sans" }, design: { audience: "客户", concept: "编辑式", typography: "大标题", layout: "响应式", interactions: "本地导航" }, entryPath: "pages/index.html", files: [
  { id: "home", path: "pages/index.html", kind: "html", content: '<!doctype html><html><head><link rel="stylesheet" href="../styles/main.css"></head><body><h1>Studio</h1><img src="../assets/hero.webp"><a href="about.html">About</a></body></html>' },
  { id: "about", path: "pages/about.html", kind: "html", content: "<h1>About</h1>" },
  { id: "style", path: "styles/main.css", kind: "css", content: 'body{background-image:url("../assets/hero.webp")}' },
  { id: "image", path: "assets/hero.webp", kind: "asset", assetId: "hero" },
], assetIds: ["hero"] });
it("checks designed web resource paths relative to their own files before publication", () => {
  const input = { purpose: "web.generate", pageCount: 2, assetIds: ["hero"] };
  expect(validateLanguageResult(input, site()).design).toEqual(site().design);
  for (const [index, content] of [[0, '<h1>Hi</h1><img src="missing.webp">'], [2, 'body{background:url("missing.webp")}'], [0, '<h1>Hi</h1><a href="absent.html">Go</a>']]) {
    const broken = site(); broken.files[index].content = content;
    expect(() => validateLanguageResult(input, broken)).toThrow("LANGUAGE_WEB_MISMATCH");
  }
  const legacy = site(); delete legacy.design; legacy.files[0].content = '<h1>Legacy</h1><img src="missing.webp">';
  expect(validateLanguageResult(input, legacy).kind).toBe("web");
});

it("gives web edits a read-only manifest and design without sending unselected file bodies", () => {
  const source = site(); source.files[1].content = "<h1>PRIVATE_UNSELECTED_COPY</h1>";
  const input = languageInputSchema.parse({ purpose: "web.edit", prompt: "改善标题", artifactId: "a", baseRevision: 1, fileIds: ["home"], paths: ["pages/index.html"] });
  const messages = creationLanguageMessages({ input, source, assets: [] }), payload = JSON.parse(messages[1].content);
  expect(payload.fileManifest.map(file => file.path)).toContain("pages/about.html");
  expect(payload.siteDesign).toEqual(source.design);
  expect(messages[1].content).not.toContain("PRIVATE_UNSELECTED_COPY");
  expect(messages[0].content).toContain("never permission to edit unselected");
});
