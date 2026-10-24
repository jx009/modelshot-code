import { expect, it } from "vitest";
import { Univer, UniverInstanceType } from "@univerjs/core";
import { inspectNativeOfficeJson, nativeOfficeArtifactSchema, saveNativeOfficeArtifactSchema } from "../../src/lib/creation/contracts/native-office.js";
import { toNativeSheetArtifact } from "../../src/lib/creation/native-sheet-adapter.js";

const doc = () => ({ schemaVersion: 2, kind: "document", title: "报告", engine: "univer", engineVersion: "1.2.0", assetIds: [], snapshot: {
  id: "document-unit", title: "报告", body: { dataStream: "你好😀\r\n", paragraphs: [{ startIndex: 4, paragraphId: "para", paragraphStyle: { namedStyleType: 4 } }], sectionBreaks: [{ startIndex: 5, sectionId: "section" }] },
  documentStyle: { documentFlavor: 1, pageSize: { width: 794, height: 1123 } },
  resources: [{ name: "custom-plugin", data: '{"extension":{"comment":"保留插件数据"}}' }],
  styles: { custom: { name: "My style", basedOn: "Normal" } }, notes: { note1: { noteId: "note1", type: "footnote", body: { dataStream: "原生脚注\r\n" } } },
} });
const book = () => ({ schemaVersion: 1, kind: "sheet", title: "费用", locale: "zh", sheets: [
  { id: "costs", name: "费用", freezeRows: 1, freezeColumns: 2, cells: [
    { id: "code", address: "A1", value: "00123", style: { bold: true, color: "#112233", background: "#eeeeee", numberFormat: "general" } },
    { id: "literal", address: "B1", value: "=SUM(A1:A2)" },
    { id: "num", address: "A2", value: 12.5, style: { numberFormat: "currency" } },
    { id: "formula", address: "B2", formula: "=SUM(A2:A3)" },
    { id: "bool", address: "A3", value: false }, { id: "null", address: "B3", value: null },
    { id: "styled", address: "C3", value: "同款样式", style: { bold: true, color: "#112233", background: "#eeeeee", numberFormat: "general" } },
  ] },
  { id: "other", name: "报价", cells: [{ id: "cross", address: "A1", formula: "='费用'!A2" }] },
] });

it("preserves complete document snapshots and unknown plugin fields instead of stripping them into semantic blocks", () => {
  const input = doc();
  input.snapshot.body.docxRawBlocks = [{ startIndex: 0, xml: '<w:p><w:r><w:t>原文</w:t></w:r></w:p>' }];
  input.snapshot.futureExtension = { arbitrary: [null, true, 1, "https://example.com is text, not an executed URL"] };
  const parsed = nativeOfficeArtifactSchema.parse(input);
  expect(JSON.stringify(parsed)).toBe(JSON.stringify(input));
  expect(parsed.snapshot.notes.note1.body.dataStream).toBe("原生脚注\r\n");
  expect(saveNativeOfficeArtifactSchema.parse({ baseRevision: 3, saveKey: "native-save-key-123456", content: parsed }).content).toEqual(input);
});

it("rejects cycles, excessive depth, accessors, prototype keys, non-JSON values and encoded byte overflow", () => {
  const cyclic = {}; cyclic.self = cyclic;
  expect(inspectNativeOfficeJson(cyclic)).toBe("NATIVE_OFFICE_JSON_INVALID");
  const repeated = { color: "red" };
  expect(inspectNativeOfficeJson({ first: repeated, second: repeated })).toBeNull();
  for (const invalid of [NaN, Infinity, undefined, () => {}, 1n, new Date(), JSON.parse('{"__proto__": {"polluted": true}}'), new Array(2)]) {
    expect(inspectNativeOfficeJson(invalid)).toBe("NATIVE_OFFICE_JSON_INVALID");
  }
  let accessed = false;
  expect(inspectNativeOfficeJson({ get value() { accessed = true; return 1; } })).toBe("NATIVE_OFFICE_JSON_INVALID");
  expect(accessed).toBe(false);
  const hiddenSerializer = Object.defineProperty({}, "toJSON", { value: () => { accessed = true; return "lost"; } });
  expect(inspectNativeOfficeJson(hiddenSerializer)).toBe("NATIVE_OFFICE_JSON_INVALID");
  expect(accessed).toBe(false);
  let deep = {};
  for (let index = 0; index < 66; index++) deep = { next: deep };
  expect(inspectNativeOfficeJson(deep)).toBe("NATIVE_OFFICE_COMPLEXITY_LIMIT");
  expect(inspectNativeOfficeJson(Array(250001).fill(null))).toBe("NATIVE_OFFICE_COMPLEXITY_LIMIT");
  expect(inspectNativeOfficeJson("汉".repeat(700000))).toBe("NATIVE_OFFICE_TOO_LARGE");
});

it("checks engine version, snapshot identity, title agreement, resource uniqueness and sparse coordinates", () => {
  for (const change of [{ engineVersion: "1.3.0" }, { engine: "unknown" }, { title: "Other" }, { assetIds: ["a", "a"] }]) {
    expect(nativeOfficeArtifactSchema.safeParse({ ...doc(), ...change }).success).toBe(false);
  }
  const duplicate = doc(); duplicate.snapshot.resources.push(duplicate.snapshot.resources[0]);
  expect(nativeOfficeArtifactSchema.safeParse(duplicate).success).toBe(false);
  const original = toNativeSheetArtifact(book(), "book-unit");
  const invalidCases = [
    data => data.sheetOrder.push("missing"),
    data => data.sheetOrder.push(data.sheetOrder[0]),
    data => { data.sheets.sheet0.id = "wrong"; },
    data => { data.sheets.sheet0.cellData[-1] = { 0: { v: "bad" } }; },
    data => { data.sheets.sheet0.cellData[0][16384] = { v: "outside" }; },
    data => { data.sheets.sheet0.rowCount = Infinity; },
  ];
  for (const change of invalidCases) { const input = structuredClone(original); change(input.snapshot); expect(nativeOfficeArtifactSchema.safeParse(input).success).toBe(false); }
});

it("converts all semantic cell types, styles, stable source IDs, sheet order and freeze panes without evaluating formulas", () => {
  const input = book(), before = structuredClone(input), output = toNativeSheetArtifact(input, "book-unit"), first = output.snapshot.sheets.sheet0;
  expect(output.snapshot.sheetOrder).toEqual(["sheet0", "sheet1"]);
  expect(first.custom.modelshot.sheetId).toBe("costs");
  expect(first.freeze).toEqual({ xSplit: 2, ySplit: 1, startRow: 1, startColumn: 2 });
  expect(first.cellData[0][0]).toMatchObject({ v: "00123", t: 1, custom: { modelshot: { cellId: "code" } } });
  expect(first.cellData[0][1]).toMatchObject({ v: "=SUM(A1:A2)", t: 1 });
  expect(first.cellData[0][1].f).toBeUndefined();
  expect(first.cellData[1][1].f).toBe("=SUM(A2:A3)");
  expect(first.cellData[1][1].v).toBeUndefined();
  expect(first.cellData[2][0]).toMatchObject({ v: false, t: 3 });
  expect(first.cellData[2][1].v).toBeNull();
  expect(first.cellData[0][0].s).toBe(first.cellData[2][2].s);
  expect(output.snapshot.styles[first.cellData[1][0].s].n.pattern).toBe('"¥"#,##0.00');
  expect(output.snapshot.sheets.sheet1.cellData[0][0].f).toBe("='费用'!A2");
  expect(input).toEqual(before);
});

it("keeps sparse maximum addresses sparse and handles source IDs that cannot be native object keys", () => {
  const input = book(); input.sheets = [{ id: "__proto__", name: "稀疏", cells: [{ id: "last", address: "XFD1048576", value: 9 }] }];
  const output = toNativeSheetArtifact(input, "sparse-book"), sheet = output.snapshot.sheets.sheet0;
  expect(sheet).toMatchObject({ rowCount: 1048576, columnCount: 16384 });
  expect(sheet.custom.modelshot.sheetId).toBe("__proto__");
  expect(Object.keys(sheet.cellData)).toEqual(["1048575"]);
  expect(Object.keys(sheet.cellData[1048575])).toEqual(["16383"]);
  expect(JSON.stringify(output).length).toBeLessThan(2000);
});

it("loads the generated data in the installed Univer core model and retains merged cells and custom resources on model snapshot", () => {
  const content = toNativeSheetArtifact(book(), "roundtrip-book");
  content.snapshot.sheets.sheet0.mergeData = [{ startRow: 5, endRow: 5, startColumn: 0, endColumn: 2 }];
  content.snapshot.resources = [{ name: "retained-custom", data: '{"notes":"保留"}' }];
  const engine = new Univer();
  try {
    const unit = engine.createUnit(UniverInstanceType.UNIVER_SHEET, structuredClone(content.snapshot));
    const sheet = unit.getSheetBySheetId("sheet0");
    expect(sheet.getCell(0, 0).v).toBe("00123");
    expect(sheet.getCell(0, 1).f).toBeUndefined();
    expect(sheet.getCell(1, 1).f).toBe("=SUM(A2:A3)");
    const saved = unit.getSnapshot();
    expect(saved.sheets.sheet0.mergeData).toEqual(content.snapshot.sheets.sheet0.mergeData);
    expect(saved.resources).toEqual(content.snapshot.resources);
    expect(saved.sheets.sheet0.cellData[0][0].custom).toEqual(content.snapshot.sheets.sheet0.cellData[0][0].custom);
    expect(nativeOfficeArtifactSchema.safeParse({ ...content, snapshot: saved }).success).toBe(true);
  } finally { engine.dispose(); }
});

it("loads a native paginated document in the installed core model without flattening its notes or styles", () => {
  const content = doc(), engine = new Univer();
  try {
    const unit = engine.createUnit(UniverInstanceType.UNIVER_DOC, structuredClone(content.snapshot));
    const saved = unit.getSnapshot();
    expect(saved.body.dataStream).toBe(content.snapshot.body.dataStream);
    expect(saved.notes).toEqual(content.snapshot.notes);
    expect(saved.styles).toEqual(content.snapshot.styles);
    expect(saved.documentStyle.documentFlavor).toBe(1);
    expect(nativeOfficeArtifactSchema.safeParse({ ...content, snapshot: saved }).success).toBe(true);
  } finally { engine.dispose(); }
});
