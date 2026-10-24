// @vitest-environment jsdom
import { expect, it } from "vitest";
import JSZip from "jszip";
import { buildWorkbookXlsx } from "../../src/lib/creation/exports/xlsx.js";
const input = { schemaVersion: 1, kind: "sheet", title: "销售", sheets: [{ id: "sales", name: "销售 < &", freezeRows: 1, freezeColumns: 1, cells: [
  { id: "a1", address: "A1", value: "商品" }, { id: "b1", address: "B1", value: "金额" }, { id: "a2", address: "A2", value: "咖啡" }, { id: "b2", address: "B2", value: 12.5 },
  { id: "c2", address: "C2", formula: "=B2*2" }, { id: "d2", address: "D2", formula: "=SUM(B2:C2)" }, { id: "e2", address: "E2", formula: '=IF(D2>20,"ok","low")' },
] }, { id: "summary", name: "Summary", cells: [{ id: "a1", address: "A1", value: true }] }] };
const parse = source => new DOMParser().parseFromString(source, "application/xml");
const all = (node, tag) => [...node.getElementsByTagName(tag)];
it("writes a native multi-sheet XLSX with formulas, calculated cached values, Unicode and frozen panes", async () => {
  const zip = await JSZip.loadAsync(await buildWorkbookXlsx(input));
  const workbook = parse(await zip.file("xl/workbook.xml").async("string")), sheet = parse(await zip.file("xl/worksheets/sheet1.xml").async("string"));
  expect(all(workbook, "sheet").map(node => node.getAttribute("name"))).toEqual(["销售 < &", "Summary"]);
  expect(all(sheet, "pane")[0].getAttribute("xSplit")).toBe("1"); expect(all(sheet, "pane")[0].getAttribute("ySplit")).toBe("1");
  expect(all(sheet, "f").map(node => node.textContent)).toEqual(["B2*2", "SUM(B2:C2)", 'IF(D2>20,"ok","low")']);
  expect(all(sheet, "v").map(node => node.textContent)).toContain("25"); expect(all(sheet, "t").map(node => node.textContent)).toContain("咖啡");
  expect(await zip.file("xl/worksheets/sheet2.xml").async("string")).toContain("<v>1</v>");
  expect(zip.file("xl/vbaProject.bin")).toBeNull(); expect(zip.file("xl/externalLinks/externalLink1.xml")).toBeNull();
});
it("does not mutate the source, rejects unsafe control characters, unsupported content, and oversized output", async () => {
  const source = structuredClone(input); await buildWorkbookXlsx(input); expect(input).toEqual(source);
  await expect(buildWorkbookXlsx({ ...input, sheets: [{ ...input.sheets[0], cells: [{ id: "bad", address: "A1", value: "bad\u0000" }] }] })).rejects.toThrow("EXPORT_SHEET_TEXT_UNSUPPORTED");
  await expect(buildWorkbookXlsx({ ...input, kind: "document" })).rejects.toThrow("EXPORT_SHEET_INVALID");
  await expect(buildWorkbookXlsx(input, { maxBytes: 10 })).rejects.toThrow("EXPORT_RESULT_TOO_LARGE");
});
it("preserves typed formula caches, styles and columns beyond Z in native XML", async () => {
  const book = { ...input, sheets: [{ id: "s", name: "Types", freezeRows: 0, freezeColumns: 27, cells: [
    { id: "a", address: "A1", formula: '="001"' }, { id: "b", address: "B1", formula: '="#REF!"' },
    { id: "c", address: "C1", formula: "=TRUE" }, { id: "d", address: "D1", formula: "=1/0" },
    { id: "e", address: "E1", value: null }, { id: "f", address: "AA2", value: 12.5, style: { bold: true, italic: true, color: "#123456", background: "#abcdef", numberFormat: "currency" } },
  ] }] };
  const zip = await JSZip.loadAsync(await buildWorkbookXlsx(book)), sheet = parse(await zip.file("xl/worksheets/sheet1.xml").async("string")), styles = parse(await zip.file("xl/styles.xml").async("string"));
  expect(all(sheet, "parsererror")).toHaveLength(0); expect(all(styles, "parsererror")).toHaveLength(0);
  const cells = new Map(all(sheet, "c").map(cell => [cell.getAttribute("r"), cell]));
  expect(cells.get("A1").getAttribute("t")).toBe("str"); expect(all(cells.get("A1"), "v")[0].textContent).toBe("001");
  expect(cells.get("B1").getAttribute("t")).toBe("str"); expect(all(cells.get("B1"), "v")[0].textContent).toBe("#REF!");
  expect(cells.get("C1").getAttribute("t")).toBe("b"); expect(all(cells.get("C1"), "v")[0].textContent).toBe("1");
  expect(cells.get("D1").getAttribute("t")).toBe("e"); expect(all(cells.get("D1"), "v")[0].textContent).toBe("#DIV/0!");
  expect(all(cells.get("E1"), "v")).toHaveLength(0);
  expect(all(sheet, "dimension")[0].getAttribute("ref")).toBe("A1:AA2");
  expect(all(sheet, "pane")[0].getAttribute("topLeftCell")).toBe("AB1"); expect(all(sheet, "pane")[0].getAttribute("activePane")).toBe("topRight");
  const styleId = Number(cells.get("AA2").getAttribute("s")), xf = all(all(styles, "cellXfs")[0], "xf")[styleId];
  expect(xf.getAttribute("numFmtId")).toBe("164");
  const font = all(styles, "font")[Number(xf.getAttribute("fontId"))], fill = all(styles, "fill")[Number(xf.getAttribute("fillId"))];
  expect(all(font, "b")).toHaveLength(1); expect(all(font, "i")).toHaveLength(1);
  expect(all(font, "color")[0].getAttribute("rgb")).toBe("FF123456"); expect(all(fill, "fgColor")[0].getAttribute("rgb")).toBe("FFABCDEF");
  expect(await zip.file("xl/_rels/workbook.xml.rels").async("string")).toContain('Target="styles.xml"');
  expect(await zip.file("[Content_Types].xml").async("string")).toContain('PartName="/xl/styles.xml"');
});
