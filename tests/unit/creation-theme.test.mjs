import { expect, it } from "vitest";
import { layoutDocumentSchema, layoutOperationsSchema } from "../../src/lib/creation/contracts/layout.js";
import { createThemeOperation } from "../../src/lib/creation/layout-theme.js";
import { applyWithInverse } from "../../src/lib/creation/layout-history.js";
import { applyLayoutOperations } from "../../src/lib/creation/layout-operations.js";
import { assertLayoutJournalCapacity, layoutOperationBytes, MAX_OPERATION_BATCH_BYTES, nextLayoutOperationBatch } from "../../src/lib/creation/layout-journal.js";
import { languageInputSchema, validateLanguageResult } from "../../src/lib/creation/contracts/language.js";

const nextTheme = { name: "Night", primary: "#ededed", accent: "#bbaaff", background: "#181830", fontFamily: "serif" };

it("retains explicit roles when a palette merges colors and later splits them again", () => {
  const original = fixture();
  original.pages[0].backgroundRole = "background";
  Object.assign(original.pages[0].nodes[0].style, { fillRole: "primary", fontRole: "theme" });
  Object.assign(original.pages[0].nodes[1], { fillRole: "accent", strokeRole: "primary" });
  const merged = applyWithInverse(original, [createThemeOperation(original, { ...nextTheme, primary: "#bbaaff" })]);
  const split = applyWithInverse(merged.document, [createThemeOperation(merged.document, { ...nextTheme, fontFamily: "mono" })]);
  const nodes = split.document.pages[0].nodes;
  expect(nodes[0].style).toMatchObject({ fill: nextTheme.primary, fillRole: "primary", fontFamily: "mono", fontRole: "theme" });
  expect(nodes[1]).toMatchObject({ fill: nextTheme.accent, stroke: nextTheme.primary, fillRole: "accent", strokeRole: "primary" });
  expect(layoutDocumentSchema.parse(split.document)).toEqual(split.document);
  expect(applyLayoutOperations(split.document, [...split.inverse, ...merged.inverse])).toEqual(original);
});

it("manual paint/font edits become custom even if equal to theme values, with exact undo and redo", () => {
  for (const bound of [false, true]) {
    const original = fixture();
    if (bound) { original.pages[0].backgroundRole = "background"; Object.assign(original.pages[0].nodes[0].style, { fillRole: "primary", fontRole: "theme" }); original.pages[0].nodes[1].fillRole = "accent"; }
    const edit = applyWithInverse(original, layoutOperationsSchema.parse([
      { op: "setTextStyle", pageId: "p0", nodeId: "text", style: { fill: original.theme.primary, fontFamily: original.theme.fontFamily } },
      { op: "setShapeStyle", pageId: "p0", nodeId: "shape", changes: { fill: original.theme.accent } },
      { op: "setPage", pageId: "p0", changes: { background: original.theme.background } },
    ]));
    const afterTheme = applyLayoutOperations(edit.document, [createThemeOperation(edit.document, nextTheme)]);
    expect(afterTheme.pages[0].background).toBe(original.theme.background);
    expect(afterTheme.pages[0].nodes[0]).toBe(edit.document.pages[0].nodes[0]);
    expect(afterTheme.pages[0].nodes[0].style).toMatchObject({ fillRole: "custom", fontRole: "custom" });
    expect(afterTheme.pages[0].nodes[1].fill).toBe(original.theme.accent);
    const undo = applyWithInverse(edit.document, layoutOperationsSchema.parse(edit.inverse));
    expect(undo.document).toEqual(original);
    expect(applyLayoutOperations(undo.document, layoutOperationsSchema.parse(undo.inverse))).toEqual(edit.document);
  }
});

it("binds the selected property immediately and leaves unrelated styles/objects unchanged", () => {
  const original = fixture();
  const result = applyWithInverse(original, layoutOperationsSchema.parse([
    { op: "setTextStyle", pageId: "p0", nodeId: "custom", style: { fillRole: "accent", fontRole: "theme" } },
    { op: "setShapeStyle", pageId: "p0", nodeId: "shape", changes: { strokeRole: "background" } },
    { op: "setPage", pageId: "p1", changes: { backgroundRole: "primary" } },
  ]));
  expect(result.document.pages[0].nodes[3].style).toMatchObject({ fill: original.theme.accent, fontFamily: "sans", fillRole: "accent", fontRole: "theme" });
  expect(result.document.pages[0].nodes[1]).toMatchObject({ stroke: original.theme.background, strokeRole: "background" });
  expect(result.document.pages[1].background).toBe(original.theme.primary);
  expect(result.document.pages[0].nodes[0]).toBe(original.pages[0].nodes[0]);
  expect(applyLayoutOperations(result.document, layoutOperationsSchema.parse(result.inverse))).toEqual(original);
});

it("preserves locked materialized styles and bindings across palette changes and exact history recovery", () => {
  const original = fixture(), locked = original.pages[0].nodes[2];
  Object.assign(locked.style, { fillRole: "primary", fontRole: "theme" });
  const changed = applyWithInverse(original, [createThemeOperation(original, nextTheme)]);
  expect(changed.document.pages[0].nodes[2]).toBe(locked);
  expect(() => applyLayoutOperations(changed.document, [{ op: "setTextStyle", pageId: "p0", nodeId: "locked", style: { fillRole: "accent" } }])).toThrow("NODE_LOCKED");
  const rebound = applyWithInverse(changed.document, [
    { op: "setNode", pageId: "p0", nodeId: "locked", changes: { locked: false } },
    { op: "setTextStyle", pageId: "p0", nodeId: "locked", style: { fillRole: "primary", fontRole: "theme" } },
  ]);
  expect(rebound.document.pages[0].nodes[2].style.fill).toBe(nextTheme.primary);
  expect(applyLayoutOperations(rebound.document, rebound.inverse)).toEqual(changed.document);
  expect(applyLayoutOperations(rebound.document, [...rebound.inverse, ...changed.inverse])).toEqual(original);
});

it("validates binding fields and keeps AI role changes inside the selected object", () => {
  const original = fixture();
  const input = languageInputSchema.parse({ purpose: "slides.edit", prompt: "Use accent color", artifactId: "deck", baseRevision: 1, pageId: "p0", nodeIds: ["text"] });
  const op = { op: "setTextStyle", pageId: "p0", nodeId: "text", style: { fillRole: "accent" } };
  expect(validateLanguageResult(input, { operations: [op] }, original).operations).toEqual([op]);
  expect(() => validateLanguageResult(input, { operations: [{ ...op, nodeId: "custom" }] }, original)).toThrow("LANGUAGE_EDIT_OUTSIDE_SCOPE");
  for (const style of [{ fillRole: "fontFamily" }, { fontRole: "accent" }, { fillRole: "__proto__" }]) expect(layoutOperationsSchema.safeParse([{ ...op, style }]).success).toBe(false);
  const withRole = applyLayoutOperations(original, [op]);
  const fontOnly = applyLayoutOperations(withRole, [{ ...op, style: { fontSize: 72 } }]);
  expect(fontOnly.pages[0].nodes[0].style.fillRole).toBe("accent");
});
function fixture() {
  const base = { x: 20, y: 20, width: 200, height: 100, name: "Object" };
  return layoutDocumentSchema.parse({ schemaVersion: 1, kind: "slides", title: "Deck", theme: { name: "Day", primary: "#112233", accent: "#FF8800", background: "#FFFFFF", fontFamily: "sans" }, pages: [
    { id: "p0", title: "Cover", width: 1920, height: 1080, background: "#ffffff", nodes: [
      { ...base, id: "text", type: "text", text: "Hello", style: { fill: "#112233", fontSize: 48 } },
      { ...base, id: "shape", type: "shape", shape: "rectangle", fill: "#ff8800ff", stroke: "#112233", strokeWidth: 3 },
      { ...base, id: "locked", type: "text", text: "Locked", locked: true, style: { fill: "#112233" } },
      { ...base, id: "custom", type: "text", text: "Custom", style: { fill: "#456789", fontFamily: "mono" } },
      { ...base, id: "image", type: "image", assetId: "photo" },
    ] },
    { id: "p1", title: "Custom page", width: 1920, height: 1080, background: "#6789ab", nodes: [] },
  ] });
}

it("updates matching theme styles while preserving custom pages, images, locks and geometry by reference", () => {
  const document = fixture(), operation = createThemeOperation(document, nextTheme);
  const result = applyWithInverse(document, layoutOperationsSchema.parse([operation]));
  const page = result.document.pages[0];
  expect(page.background).toBe(nextTheme.background);
  expect(page.nodes[0]).toEqual({ ...document.pages[0].nodes[0], style: { ...document.pages[0].nodes[0].style, fill: nextTheme.primary, fontFamily: "serif" } });
  expect(page.nodes[1]).toEqual({ ...document.pages[0].nodes[1], fill: nextTheme.accent, stroke: nextTheme.primary });
  for (const index of [2, 3, 4]) expect(page.nodes[index]).toBe(document.pages[0].nodes[index]);
  expect(result.document.pages[1]).toBe(document.pages[1]);
  expect(applyLayoutOperations(result.document, layoutOperationsSchema.parse(result.inverse))).toEqual(document);
  expect(document.pages[0].background).toBe("#ffffff");
});

it("undoes palette collisions exactly, then redoes after intervening page and node reorders are undone", () => {
  const document = fixture();
  const changes = [createThemeOperation(document, { ...nextTheme, primary: "#bbaaff" }), { op: "reorderNode", pageId: "p0", nodeId: "text", index: 4 }, { op: "reorderPage", pageId: "p1", index: 0 }];
  const changed = applyWithInverse(document, changes), undone = applyWithInverse(changed.document, changed.inverse);
  expect(undone.document).toEqual(document);
  expect(applyLayoutOperations(undone.document, undone.inverse)).toEqual(changed.document);
});

it("does not guess the role of shared old colors or replace a custom transparent variant", () => {
  const document = fixture();
  document.theme.accent = document.theme.primary;
  document.pages[0].nodes[1].fill = "#11223380";
  const result = applyLayoutOperations(document, [createThemeOperation(document, nextTheme)]);
  expect(result.pages[0].nodes[0].style.fill).toBe("#112233");
  expect(result.pages[0].nodes[0].style.fontFamily).toBe("serif");
  expect(result.pages[0].nodes[1]).toBe(document.pages[0].nodes[1]);
});

it("rejects invalid or locked indexed targets atomically and prevents an AI page edit from changing the whole theme", () => {
  const document = fixture(), before = structuredClone(document), valid = createThemeOperation(document, nextTheme);
  const patch = nodes => ({ ...valid, pages: [{ index: 0, nodes }] });
  for (const operation of [patch([[2, "#ffffff", null, null]]), patch([[4, "#ffffff", null, null]]), patch([[0, null, "#ffffff", null]]), patch([[0, null, null, null]]), patch([[0, "#ffffff", null, null], [0, "#000000", null, null]]), { ...valid, pages: [...valid.pages, valid.pages[0]] }]) {
    expect(() => applyLayoutOperations(document, [operation])).toThrow();
    expect(document).toEqual(before);
  }
  const input = languageInputSchema.parse({ purpose: "slides.edit", prompt: "Change title", artifactId: "deck", baseRevision: 1, pageId: "p0" });
  expect(() => validateLanguageResult(input, { operations: [valid] }, document)).toThrow("LANGUAGE_EDIT_OUTSIDE_SCOPE");
  expect(layoutOperationsSchema.safeParse([{ ...valid, pages: [{ index: 0, nodes: [[0, "url(x)", null, null]] }] }]).success).toBe(false);
});

it("keeps a 5000-object theme and exact inverse indivisible and below the save request limit", () => {
  const source = fixture(), shape = source.pages[0].nodes[1];
  const document = { ...source, pages: Array.from({ length: 100 }, (_, index) => ({ ...source.pages[0], id: `page${index}`, nodes: Array.from({ length: 50 }, (_, i) => ({ ...shape, id: `node${i}` })) })) };
  const operation = createThemeOperation(document, nextTheme);
  const result = applyWithInverse(document, [operation]);
  for (const item of [operation, ...result.inverse]) {
    expect(layoutOperationsSchema.safeParse([item]).success).toBe(true);
    expect(layoutOperationBytes(item)).toBeLessThan(MAX_OPERATION_BATCH_BYTES);
    expect(nextLayoutOperationBatch([item])).toEqual([item]);
  }
  expect(applyLayoutOperations(result.document, result.inverse)).toEqual(document);
  const operations = [operation, ...result.inverse, operation, ...result.inverse];
  const first = nextLayoutOperationBatch(operations);
  expect(first.length).toBeGreaterThan(0);
  expect(first.length).toBeLessThan(operations.length);
  expect(Buffer.byteLength(JSON.stringify({ baseRevision: 1, saveKey: "k".repeat(128), operations: first }))).toBeLessThan(256 * 1024);
  const drained = [];
  while (drained.length < operations.length) {
    const batch = nextLayoutOperationBatch(operations.slice(drained.length));
    expect(batch.length).toBeGreaterThan(0);
    expect(Buffer.byteLength(JSON.stringify(batch))).toBeLessThanOrEqual(MAX_OPERATION_BATCH_BYTES);
    drained.push(...batch);
  }
  expect(drained).toEqual(operations);
  expect(() => assertLayoutJournalCapacity([], Array(10).fill(operation))).toThrow("PENDING_EDIT_LIMIT");
});

it("accounts for UTF-8 bytes and refuses oversized single operations before mutating the local journal", () => {
  const operation = { op: "setText", pageId: "p", nodeId: "n", text: "中".repeat(90000) }, pending = [];
  expect(() => assertLayoutJournalCapacity(pending, [operation])).toThrow("LAYOUT_OPERATION_TOO_LARGE");
  expect(() => nextLayoutOperationBatch([operation])).toThrow("LAYOUT_OPERATION_TOO_LARGE");
  expect(pending).toEqual([]);
  const small = { ...operation, text: "中".repeat(12000) };
  expect(nextLayoutOperationBatch(Array(10).fill(small)).length).toBeLessThan(10);
});
