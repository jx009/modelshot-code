// @vitest-environment jsdom
import { createRef } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import SheetArtifactEditor from "../../src/components/creation/SheetArtifactEditor";
import { workbookSchema } from "../../src/lib/creation/contracts/sheet.js";

const mocks = vi.hoisted(() => ({ api: vi.fn(), read: vi.fn(), write: vi.fn(), readText: vi.fn(), writeText: vi.fn(), exported: vi.fn() }));
vi.mock("../../src/lib/client-api", () => ({ api: (...args) => mocks.api(...args), requestKey: () => "sheet-editor-key-12345" }));
vi.mock("../../src/lib/studio/project-list", () => ({ invalidateProjectLists: vi.fn() }));
vi.mock("../../src/components/creation/DraftSessionGate", () => ({ default: ({ children }) => children("sheet-session-12345") }));
vi.mock("../../src/lib/creation/client/drafts", () => ({ readArtifactDraft: (...args) => mocks.read(...args), writeArtifactDraft: (...args) => mocks.write(...args), readArtifactTextDraft: (...args) => mocks.readText(...args), writeArtifactTextDraft: (...args) => mocks.writeText(...args) }));
vi.mock("../../src/components/creation/ExportDialog", () => ({ default: ({ onFlush }) => <button onClick={() => void onFlush().then(mocks.exported)}>Export current version</button> }));
const book = () => workbookSchema.parse({ schemaVersion: 1, kind: "sheet", title: "Sales", sheets: [
  { id: "sales", name: "Sales", cells: [{ id: "a", address: "A1", value: 10, style: { bold: true } }, { id: "b", address: "B1", formula: "=A1*2" }] },
  { id: "costs", name: "Costs", cells: [{ id: "cost", address: "A1", value: 5 }] },
] });
const recovered = (text = "15") => ({ kind: "sheet-cell", sheetId: "sales", address: "A1", cellId: "a", original: { id: "a", value: 10 }, text, composing: false });
beforeEach(() => {
  Object.values(mocks).forEach(mock => mock.mockReset());
  mocks.read.mockResolvedValue(null); mocks.readText.mockResolvedValue(null); mocks.write.mockResolvedValue(undefined);
  mocks.writeText.mockImplementation(async (_u, _a, _value, prepare) => { await prepare?.(); });
  mocks.api.mockImplementation(async (_url, options) => options?.method === "PATCH" ? { artifactId: "a", revision: 2 } : { revision: 1, content: book() });
});
afterEach(cleanup);
async function open() {
  const editorRef = createRef(), onError = vi.fn(), onReference = vi.fn();
  const view = render(<SheetArtifactEditor artifactId="a" userId="u" zh={false} editorRef={editorRef} onError={onError} onReference={onReference} />);
  await screen.findByLabelText("Cell value or formula");
  await waitFor(() => expect(screen.getByLabelText("Cell value or formula").disabled).toBe(false));
  return { editorRef, onError, onReference, view };
}
const writes = () => mocks.api.mock.calls.filter(([, options]) => options?.method);
it("shares grid and formula input, persists only the cell draft while typing and flushes before blur", async () => {
  const { editorRef } = await open();
  fireEvent.change(screen.getByLabelText("A1"), { target: { value: "15" } });
  expect(screen.getByLabelText("A1").value).toBe("15"); expect(screen.getByLabelText("Cell value or formula").value).toBe("15");
  expect(writes()).toHaveLength(0); expect(mocks.write).not.toHaveBeenCalled();
  await waitFor(() => expect(mocks.writeText).toHaveBeenCalled());
  expect(mocks.writeText.mock.calls.at(-1)[2]).toMatchObject({ text: "15", original: { id: "a", value: 10 } });
  let saved; await act(async () => { saved = await editorRef.current.flush(); });
  expect(saved.revision).toBe(2); expect(saved.content.sheets[0].cells[0]).toMatchObject({ value: 15, style: { bold: true } });
  expect(writes()[0][1].body.operations).toEqual([{ op: "setCell", sheetId: "sales", address: "A1", id: "a", value: 15, expectedValue: 10 }]);
  const clearIndex = mocks.writeText.mock.calls.findIndex(call => call[2] === null);
  expect(mocks.write.mock.invocationCallOrder[0]).toBeLessThan(mocks.writeText.mock.invocationCallOrder[clearIndex]);
});
it("rejects incomplete formulas on save and view switches while keeping the input editable", async () => {
  const { editorRef, onError } = await open();
  fireEvent.change(screen.getByLabelText("Cell value or formula"), { target: { value: "=SUM(" } });
  await act(async () => { await expect(editorRef.current.flush()).rejects.toThrow("SHEET_CELL_INPUT_INVALID"); });
  fireEvent.change(screen.getByLabelText("Sheet"), { target: { value: "1" } });
  await waitFor(() => expect(onError).toHaveBeenCalled());
  expect(screen.getByLabelText("Sheet").value).toBe("0"); expect(screen.getByLabelText("A1").value).toBe("=SUM(");
  expect(writes()).toHaveLength(0); expect(mocks.write).not.toHaveBeenCalled();
});
it("blocks IME commits until composition completes and preserves the completed text through undo", async () => {
  const { editorRef } = await open(), input = screen.getByLabelText("A1");
  fireEvent.compositionStart(input); fireEvent.change(input, { target: { value: "咖啡" } });
  await act(async () => { await expect(editorRef.current.flush()).rejects.toThrow("TEXT_COMPOSITION_ACTIVE"); });
  fireEvent.compositionEnd(input);
  await act(async () => { await editorRef.current.flush(); });
  expect(writes()[0][1].body.operations[0].value).toBe("咖啡");
  fireEvent.click(screen.getByLabelText("Undo"));
  await waitFor(() => expect(screen.getByLabelText("A1").value).toBe("10"));
});
it("commits the old cell before switching focus and builds the next draft against the new target", async () => {
  const { editorRef } = await open();
  fireEvent.change(screen.getByLabelText("A1"), { target: { value: "12" } });
  fireEvent.focus(screen.getByLabelText("B1 formula"));
  await waitFor(() => expect(screen.getByLabelText("Cell value or formula").value).toBe("=A1*2"));
  fireEvent.change(screen.getByLabelText("Cell value or formula"), { target: { value: "=A1*3" } });
  await act(async () => { await editorRef.current.flush(); });
  const operations = writes().flatMap(([, options]) => options.body.operations);
  expect(operations.map(op => op.address)).toEqual(["A1", "B1"]);
  expect(operations[1]).toMatchObject({ expectedFormula: "=A1*2", formula: "=A1*3" });
});
it("exports the pending formula through the same flush barrier", async () => {
  await open(); fireEvent.change(screen.getByLabelText("Cell value or formula"), { target: { value: "=B1+1" } });
  fireEvent.click(screen.getByLabelText("Export"));
  fireEvent.click(await screen.findByText("Export current version"));
  await waitFor(() => expect(mocks.exported).toHaveBeenCalled());
  expect(mocks.exported.mock.calls[0][0].content.sheets[0].cells[0].formula).toBe("=B1+1");
});
it("requires an explicit recovery decision and rejects replacing a changed cloud cell", async () => {
  mocks.readText.mockResolvedValue(recovered());
  const changed = book(); changed.sheets[0].cells[0].value = 20;
  mocks.api.mockResolvedValue({ revision: 3, content: changed });
  const editorRef = createRef(); render(<SheetArtifactEditor artifactId="a" userId="u" zh={false} editorRef={editorRef} onError={vi.fn()} />);
  await screen.findByLabelText("Recovered cell text");
  expect(screen.getByLabelText("A1").disabled).toBe(true);
  fireEvent.click(screen.getByText("Continue editing"));
  await waitFor(() => expect(screen.getByLabelText("A1").value).toBe("15"));
  await act(async () => { await expect(editorRef.current.flush()).rejects.toThrow("SHEET_CELL_CHANGED"); });
  fireEvent.click(screen.getByText("Discard input")); expect(screen.getByLabelText("A1").value).toBe("15");
  fireEvent.click(screen.getByText("Confirm discard")); await waitFor(() => expect(screen.getByLabelText("A1").value).toBe("20"));
  expect(writes()).toHaveLength(0);
});
it("warns before closing and flushes pending input to the local journal on unmount", async () => {
  const { view } = await open(); fireEvent.change(screen.getByLabelText("A1"), { target: { value: "Closing draft" } });
  const before = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(before); expect(before.defaultPrevented).toBe(true);
  view.unmount(); await waitFor(() => expect(mocks.writeText).toHaveBeenCalled());
  expect(mocks.writeText.mock.calls.at(-1)[2].text).toBe("Closing draft");
});
it("retries a failed draft clear without applying the cell operation twice", async () => {
  const { editorRef } = await open();
  let failClear = true;
  mocks.writeText.mockImplementation(async (_u, _a, value, prepare) => {
    await prepare?.();
    if (value === null && failClear) { failClear = false; throw new Error("LOCAL_DRAFT_UNAVAILABLE"); }
  });
  fireEvent.change(screen.getByLabelText("A1"), { target: { value: "18" } });
  await act(async () => { await expect(editorRef.current.flush()).rejects.toThrow("LOCAL_DRAFT_UNAVAILABLE"); });
  expect(screen.getByLabelText("A1").value).toBe("18"); expect(writes()).toHaveLength(0);
  await act(async () => { await editorRef.current.flush(); });
  expect(writes().flatMap(([, options]) => options.body.operations)).toHaveLength(1);
  expect(screen.queryByText("Unapplied cell input")).toBeNull();
});
