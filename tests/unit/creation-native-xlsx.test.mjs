import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import JSZip from "jszip";
import { Univer, UniverInstanceType } from "@univerjs/core";
import { toNativeSheetArtifact } from "../../src/lib/creation/native-sheet-adapter.js";
import { buildNativeWorkbookXlsx } from "../../src/lib/creation/exports/native-xlsx.js";

const native = () => toNativeSheetArtifact({ schemaVersion: 1, kind: "sheet", title: "预算", sheets: [{ id: "s", name: "收入", cells: [
  { id: "a", address: "A1", value: "中文😀 & <tag> _x0041_\r\n", style: { bold: true, color: "#123456", numberFormat: "general" } },
  { id: "b", address: "B2", value: 25.5, style: { numberFormat: "currency" } },
  { id: "c", address: "C3", formula: "=SUM(B2:B2)", style: { italic: true } },
], freezeRows: 1, freezeColumns: 1 }] }, "workbook");
async function inspect(bytes) {
  const zip = await JSZip.loadAsync(bytes), files = {};
  for (const [name, file] of Object.entries(zip.files)) {
    if (!file.dir && /\.(xml|rels)$/.test(name)) {
      const text = await file.async("string"), dom = new JSDOM(text, { contentType: "application/xml" });
      files[name] = dom.window.document; // XML parsing fails on malformed output.
    }
  }
  return files;
}
it("exports the browser-saved workbook with edited values and formulas, without dropping permissions", async () => {
  const content = JSON.parse(readFileSync(new URL("../fixtures/creation-native-sheet-browser.json", import.meta.url), "utf8"));
  const before = structuredClone(content), files = await inspect(await buildNativeWorkbookXlsx(content)), sheet = files["xl/worksheets/sheet1.xml"];
  expect(sheet.querySelector('c[r="B2"] v').textContent).toBe("4200");
  expect(sheet.querySelector('c[r="B4"] f').textContent).toBe("SUM(B2:B3)");
  expect(content).toEqual(before);
  content.snapshot.resources.find(item => item.name === "SHEET_AuthzIoMockService_PLUGIN").data = '{"private":true}';
  await expect(buildNativeWorkbookXlsx(content)).rejects.toThrow("EXPORT_NATIVE_FEATURE_UNSUPPORTED");
});
it("exports real ZIP/XML with editable typed cells, literal escape sequences and no stale formula cache", async () => {
  const source = native(), original = structuredClone(source);
  source.snapshot.sheets.sheet0.cellData[2][2].v = 999999;
  const files = await inspect(await buildNativeWorkbookXlsx(source)), sheet = files["xl/worksheets/sheet1.xml"];
  expect(sheet.querySelector('c[r="A1"] t').textContent).toBe("中文😀 & <tag> _x005F_x0041_\r\n");
  expect(sheet.querySelector('c[r="B2"] v').textContent).toBe("25.5");
  expect(sheet.querySelector('c[r="C3"] f').textContent).toBe("SUM(B2:B2)");
  expect(sheet.querySelector('c[r="C3"] v')).toBeNull();
  expect(files["xl/styles.xml"].querySelector("numFmt").getAttribute("formatCode")).toBe('"¥"#,##0.00');
  expect(sheet.querySelector("pane").getAttribute("topLeftCell")).toBe("B2");
  expect(files["xl/workbook.xml"].querySelector("calcPr").getAttribute("forceFullCalc")).toBe("1");
  delete source.snapshot.sheets.sheet0.cellData[2][2].v; expect(source).toEqual(original);
});

it("preserves style details, merge ranges, dimensions, hiding/order and the 1904 date system", async () => {
  const source = native(), sheet = source.snapshot.sheets.sheet0;
  sheet.cellData[0][0].s = { ff: "Noto Sans CJK SC", fs: 18, bl: 1, it: 1, ul: { s: 1, t: 10 }, st: { s: 1 }, bg: { rgb: "#abc" }, cl: { rgb: "#010203" }, bd: { b: { s: 7, cl: { rgb: "#445566" } } }, ht: 2, vt: 2, tb: 3, tr: { a: -45 }, stf: 0 };
  sheet.rowData = { 0: { h: 40 }, 4: { hd: 1 }, 6: { ia: 1, ah: 60 } }; sheet.columnData = { 0: { w: 145 }, 2: { hd: 1 } };
  sheet.mergeData = [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 1 }]; sheet.tabColor = "#123456";
  source.snapshot.dateSystem = "date1904";
  const second = structuredClone(sheet); second.id = "second"; second.name = "隐藏"; second.hidden = 2;
  source.snapshot.sheets.second = second; source.snapshot.sheetOrder.unshift("second");
  const files = await inspect(await buildNativeWorkbookXlsx(source)), s = files["xl/worksheets/sheet2.xml"], styles = files["xl/styles.xml"];
  expect(files["xl/workbook.xml"].querySelector("sheet").getAttribute("state")).toBe("veryHidden");
  expect(files["xl/workbook.xml"].querySelector("workbookView").getAttribute("activeTab")).toBe("1");
  expect(files["xl/workbook.xml"].querySelector("workbookPr").getAttribute("date1904")).toBe("1");
  expect(s.querySelector("mergeCell").getAttribute("ref")).toBe("A1:B1");
  expect(s.querySelector('row[r="1"]').getAttribute("ht")).toBe("30");
  expect(s.querySelector('row[r="5"]').getAttribute("hidden")).toBe("1");
  expect(s.querySelector('row[r="7"]').getAttribute("ht")).toBe("45");
  expect(s.querySelector('col[min="1"]').getAttribute("width")).toBe("20.7109375");
  expect(s.querySelector('col[min="3"]').getAttribute("hidden")).toBe("1");
  expect(styles.querySelector('name[val="Noto Sans CJK SC"]')).not.toBeNull();
  expect(styles.querySelector('u[val="double"]')).not.toBeNull(); expect(styles.querySelector('bottom[style="double"]')).not.toBeNull();
  expect(styles.querySelector('fgColor[rgb="FFAABBCC"]')).not.toBeNull();
  expect(styles.querySelector('alignment[textRotation="45"]').getAttribute("wrapText")).toBe("1");
});

it("accepts an actual Univer core model save instead of relying only on hand-built fixtures", async () => {
  const source = native(), engine = new Univer();
  try {
    const model = engine.createUnit(UniverInstanceType.UNIVER_SHEET, source.snapshot);
    const saved = { ...source, snapshot: model.save() };
    const files = await inspect(await buildNativeWorkbookXlsx(saved));
    expect(files["xl/worksheets/sheet1.xml"].querySelector('c[r="B2"] v').textContent).toBe("25.5");
  } finally { engine.dispose(); }
});

it("keeps formula-like plain strings inert and boolean/numeric values typed", async () => {
  const source = native(); source.snapshot.sheets.sheet0.cellData = { 0: { 0: { v: "=SUM(1,2)", t: 4 }, 1: { v: true, t: 3 }, 2: { v: 0, t: 3 }, 3: { v: -1.5, t: 2 } } };
  const files = await inspect(await buildNativeWorkbookXlsx(source)), sheet = files["xl/worksheets/sheet1.xml"];
  expect(sheet.querySelector('c[r="A1"]').getAttribute("t")).toBe("inlineStr"); expect(sheet.querySelector("f")).toBeNull();
  expect(sheet.querySelector('c[r="B1"] v').textContent).toBe("1"); expect(sheet.querySelector('c[r="C1"] v').textContent).toBe("0");
  expect(sheet.querySelector('c[r="D1"] v').textContent).toBe("-1.5");
});

it("refuses authored features that cannot be represented without silently removing data", async () => {
  for (const edit of [
    d => { d.snapshot.resources = [{ name: "SHEET_RANGE_PROTECTION_PLUGIN", data: '{"rule":1}' }]; },
    d => { d.snapshot.sheets.sheet0.cellData[0][0].p = { body: { dataStream: "rich\r\n" } }; },
    d => { d.snapshot.sheets.sheet0.backgroundImage = { source: "private" }; },
    d => { d.snapshot.sheets.sheet0.custom.other = { data: "retained" }; },
    d => { d.snapshot.calculationSettings = { iterativeCalculation: { enabled: true } }; },
  ]) {
    const source = native(); edit(source); const copy = structuredClone(source);
    await expect(buildNativeWorkbookXlsx(source)).rejects.toThrow("EXPORT_NATIVE_FEATURE_UNSUPPORTED"); expect(source).toEqual(copy);
  }
  for (const style of [{ pd: { l: 10 } }, { tb: 2 }, { bg: { th: 3 } }, { ul: { s: 1, c: 0, cl: { rgb: "#123456" } } }, { bd: { tl_br: { s: 1 } } }]) {
    const source = native(); source.snapshot.sheets.sheet0.cellData[0][0].s = style;
    await expect(buildNativeWorkbookXlsx(source)).rejects.toThrow(/EXPORT_NATIVE_(?:STYLE|FEATURE)_UNSUPPORTED/);
  }
});

it("refuses overlapping merges, hidden covered values and oversized merge expansion", async () => {
  const source = native(), sheet = source.snapshot.sheets.sheet0;
  sheet.mergeData = [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 1 }, { startRow: 0, startColumn: 1, endRow: 0, endColumn: 2 }];
  await expect(buildNativeWorkbookXlsx(source)).rejects.toThrow("EXPORT_NATIVE_MERGE_UNSUPPORTED");
  sheet.mergeData.pop(); sheet.cellData[0][1] = { v: "Do not discard me", t: 1 };
  await expect(buildNativeWorkbookXlsx(source)).rejects.toThrow("EXPORT_NATIVE_MERGE_UNSUPPORTED");
  sheet.rowCount = 100000; sheet.mergeData = [{ startRow: 0, startColumn: 0, endRow: 99999, endColumn: 1 }];
  await expect(buildNativeWorkbookXlsx(source)).rejects.toThrow("EXPORT_NATIVE_SHEET_LIMIT");
});

it("rejects unsafe/external/array formulas, unknown styles and out-of-grid row dimensions", async () => {
  for (const cell of [{ f: '=WEBSERVICE("https://example.com")' }, { f: "=[Other.xlsx]Sheet1!A1" }, { f: "='[Other]Sheet'!A1" }, { f: "=SUM(A1:A2)", ft: 1 }, { f: "=SUM(A1:A2)", si: "shared" }, { f: "=A1:A2*2" }, { f: "=IF(TRUE,A1:A3,0)" }, { f: "='Missing'!A1" }]) {
    const source = native(); source.snapshot.sheets.sheet0.cellData[2][2] = cell;
    await expect(buildNativeWorkbookXlsx(source)).rejects.toThrow("EXPORT_NATIVE_FORMULA_UNSUPPORTED");
  }
  const source = native(); source.snapshot.sheets.sheet0.cellData[0][0].s = "missing";
  await expect(buildNativeWorkbookXlsx(source)).rejects.toThrow("EXPORT_NATIVE_STYLE_UNSUPPORTED");
  source.snapshot.sheets.sheet0.cellData[0][0].s = {};
  source.snapshot.sheets.sheet0.rowData = { 99999: { h: 30 } };
  await expect(buildNativeWorkbookXlsx(source)).rejects.toThrow("EXPORT_NATIVE_SHEET_INVALID");
  delete source.snapshot.sheets.sheet0.rowData;
  await expect(buildNativeWorkbookXlsx(source, { maxBytes: 10 })).rejects.toThrow("EXPORT_RESULT_TOO_LARGE");
});

it("supports explicit inert defaults and opaque RGB colors while bounding formula references", async () => {
  const source = native(); source.snapshot.sheets.sheet0.cellData[0][0].s = { bl: 1, ol: { s: 0 }, bbl: { s: 0 }, pd: { l: 0, t: 0 }, bg: { rgb: "rgb(255, 0, 128)" } };
  const files = await inspect(await buildNativeWorkbookXlsx(source));
  expect(files["xl/styles.xml"].querySelector('fgColor[rgb="FFFF0080"]')).not.toBeNull();
  source.snapshot.sheets.sheet0.cellData[2][2].f = "=SUM(A1:A100001)";
  await expect(buildNativeWorkbookXlsx(source)).rejects.toThrow("EXPORT_NATIVE_SHEET_LIMIT");
});
