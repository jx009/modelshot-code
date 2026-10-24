import { expect, it, vi } from "vitest";
import { createNativeSheetInputRecovery, readNativeSheetInput } from "../../src/lib/creation/client/native-sheet-input.js";

const input = (text = "未确认 =SUM(A1:A3)", extra = {}) => ({ unitId: "unit", sheetId: "sheet", row: 1, column: 2, text, composing: false, compositionText: "", ...extra });
const draft = entry => ({ format: "univer-sheet-input-1", entries: [{ ...entry, revision: 3, capturedAt: 1 }] });
const content = value => ({ kind: "sheet", snapshot: { id: "unit", sheets: { sheet: { cellData: { 1: { 2: value } } } } } });
function setup(initial = null) {
  let data = initial;
  const read = vi.fn(async () => data), write = vi.fn(async (next, prepare) => { await prepare?.(); data = structuredClone(next); });
  return { read, write, get data() { return data; }, recovery: createNativeSheetInputRecovery({ read, write }) };
}

it("reads the live editor model, preserves internal breaks/formulas and checks the workbook identity", () => {
  const getBody = vi.fn(() => ({ dataStream: " =SUM(A1:A3)\rnext\r\n" }));
  const instances = { getUnit: vi.fn(() => ({ getBody })) };
  const bridge = { isVisible: () => ({ visible: true }), getEditorDirty: () => true, getCurrentEditorId: () => "editor", getEditCellState: () => ({ unitId: "unit", sheetId: "sheet", row: 1, column: 2, documentLayoutObject: { documentModel: { getBody: () => ({ dataStream: "OLD\r\n" }) } } }) };
  const options = { bridge, instances, documentType: 1, unitId: "unit" };
  expect(readNativeSheetInput(options)).toEqual({ unitId: "unit", sheetId: "sheet", row: 1, column: 2, text: " =SUM(A1:A3)\rnext" });
  expect(instances.getUnit).toHaveBeenCalledWith("editor", 1);
  expect(readNativeSheetInput({ ...options, unitId: "other" })).toBeNull();
  expect(instances.getUnit).toHaveBeenCalledTimes(1);
  bridge.getEditorDirty = () => false;
  expect(readNativeSheetInput(options)).toBeNull();
  expect(readNativeSheetInput({ ...options, composing: true })).not.toBeNull();
  getBody.mockReturnValue({ dataStream: "x".repeat(32769) + "\r\n" });
  expect(() => readNativeSheetInput({ ...options, composing: true })).toThrow("NATIVE_OFFICE_INPUT_BACKUP_LIMIT");
});

it("coalesces equal cell text and recovers it without allowing new input or autosave to overwrite it", async () => {
  const t = setup(); await t.recovery.open();
  expect(t.recovery.capture(input(), 3)).toBe(true); await t.recovery.persist();
  expect(t.recovery.capture(input(), 3)).toBe(false); await t.recovery.persist();
  expect(t.write).toHaveBeenCalledOnce();
  const next = createNativeSheetInputRecovery(t); await next.open();
  expect(next.getState()[0]).toMatchObject(input());
  expect(next.capture(input("new"), 4)).toBe(false);
  await next.settle(content({ v: input().text })); expect(t.write).toHaveBeenCalledOnce();
  t.write.mockRejectedValueOnce(new Error("quota"));
  await expect(next.dismiss()).rejects.toThrow("quota"); expect(next.getState()).toHaveLength(1);
  await next.dismiss(); expect(next.getState()).toEqual([]); expect(t.data).toBeNull();
});

it("clears only exact confirmed text after the workbook draft is durable and retains backups on failed writes", async () => {
  const t = setup(); await t.recovery.open(); t.recovery.capture(input("=SUM(A1:A3)"), 3); await t.recovery.persist();
  let release; const stored = new Promise(resolve => { release = resolve; });
  const clearing = t.recovery.settle(content({ f: "=SUM(A1:A3)", v: 6 }), () => stored);
  await Promise.resolve(); expect(t.data.entries).toHaveLength(1);
  release(); await clearing; expect(t.data).toBeNull();
  t.recovery.capture(input("retain"), 3); await t.recovery.persist();
  await expect(t.recovery.settle(content({ v: "retain" }), () => Promise.reject(new Error("workbook write failed")))).rejects.toThrow("workbook write failed");
  await t.recovery.persist(); expect(t.data.entries[0].text).toBe("retain");
});

it("retains composing, formatted and mismatched values; does not clear newer input during a delayed acknowledgement", async () => {
  const t = setup(); await t.recovery.open();
  t.recovery.capture(input("中文", { composing: true, compositionText: "中文候选" }), 3); await t.recovery.persist();
  await t.recovery.settle(content({ v: "中文" })); expect(t.data.entries[0].compositionText).toBe("中文候选");
  t.recovery.capture(input("001"), 3); await t.recovery.persist(); await t.recovery.settle(content({ v: 1 }));
  expect(t.data.entries[0].text).toBe("001");
  let finish; const gate = new Promise(resolve => { finish = resolve; });
  const clearing = t.recovery.settle(content({ v: "001" }), () => gate);
  t.recovery.capture(input("new"), 3); finish(); await clearing; await t.recovery.persist();
  expect(t.data.entries[0].text).toBe("new");
});

it("bounds stored cells/text, leaves previous data intact, and fails closed for malformed local records", async () => {
  const t = setup(); await t.recovery.open();
  for (let row = 0; row < 8; row++) t.recovery.capture(input(String(row), { row }), 3);
  expect(() => t.recovery.capture(input("ninth", { row: 8 }), 3)).toThrow("NATIVE_OFFICE_INPUT_BACKUP_LIMIT");
  expect(() => t.recovery.capture(input("x".repeat(32769)), 3)).toThrow("NATIVE_OFFICE_INPUT_BACKUP_LIMIT");
  await t.recovery.persist(); expect(t.data.entries).toHaveLength(8);
  const malformed = setup(draft(input("x", { row: -1 })));
  await expect(malformed.recovery.open()).rejects.toThrow("NATIVE_OFFICE_INPUT_BACKUP_UNAVAILABLE");
  expect(malformed.write).not.toHaveBeenCalled();
});
