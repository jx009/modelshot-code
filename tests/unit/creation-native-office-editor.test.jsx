// @vitest-environment jsdom
import { Activity, createRef } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import NativeOfficeArtifactEditor from "../../src/components/creation/NativeOfficeArtifactEditor";
import { toNativeSheetArtifact } from "../../src/lib/creation/native-sheet-adapter.js";
import { toNativeDocumentArtifact } from "../../src/lib/creation/native-document-adapter.js";

const ports = vi.hoisted(() => ({ api: vi.fn(), readInput: vi.fn(), writeInput: vi.fn(), read: vi.fn(), write: vi.fn(), load: vi.fn(), mount: vi.fn(), data: null, options: null, sequence: 0, pending: false, dispose: vi.fn(), kind: "sheet" }));
vi.mock("../../src/components/creation/DraftSessionGate", () => ({ default: ({ children }) => children("test-session-123456") }));
vi.mock("../../src/components/ui/Modal", () => ({ default: ({ children }) => <div role="dialog">{children}</div> }));
vi.mock("../../src/lib/client-api", () => ({ api: (...args) => ports.api(...args), requestKey: () => crypto.randomUUID() }));
vi.mock("../../src/lib/creation/client/drafts", () => ({ readArtifactDraft: (...args) => ports.read(...args), writeArtifactDraft: (...args) => ports.write(...args), readArtifactTextDraft: (...args) => ports.readInput(...args), writeArtifactTextDraft: (...args) => ports.writeInput(...args) }));
vi.mock("../../src/lib/studio/project-list", () => ({ invalidateProjectLists: vi.fn() }));
vi.mock("../../src/lib/creation/client/native-office-loader", () => ({ loadNativeOfficeRuntime: (...args) => ports.load(...args) }));
const native = () => ports.kind === "document" ? toNativeDocumentArtifact({ schemaVersion: 1, kind: "document", title: "Report", sections: [{ id: "s", title: "Section", blocks: [{ id: "p", type: "paragraph", runs: [{ text: "Original", marks: {} }] }] }] }, "unit") : toNativeSheetArtifact({ schemaVersion: 1, kind: "sheet", title: "Budget", sheets: [{ id: "s", name: "Sheet", cells: [] }] }, "unit");
let draft, inputDraft;
beforeEach(() => {
  vi.resetAllMocks(); sessionStorage.clear(); draft = null; inputDraft = null; ports.kind = "sheet"; ports.data = native(); ports.sequence = 0; ports.pending = false;
  ports.readInput.mockImplementation(async () => inputDraft);
  ports.writeInput.mockImplementation(async (_u, _a, value, prepare) => { await prepare?.(); inputDraft = structuredClone(value); });
  ports.read.mockImplementation(async () => draft);
  ports.write.mockImplementation(async (_user, _artifact, value) => { draft = structuredClone(value); });
  ports.api.mockImplementation(async (path, options = {}) => {
    if (path.endsWith("/copy")) return { artifactId: "copy", revision: 1 };
    if (options.method === "PUT") return { artifactId: "a", baseRevision: options.body.baseRevision, revision: options.body.baseRevision + 1 };
    return { id: "a", revision: 1, content: native() };
  });
  ports.mount.mockImplementation(async options => {
    ports.options = options; ports.data.snapshot = structuredClone(options.snapshot);
    return { get sequence() { return ports.sequence; }, isInputPending: () => ports.pending,
      pendingInput: () => ({ unitId: "unit", sheetId: "sheet0", row: 0, column: 0, text: "Unconfirmed 中文", composing: true, compositionText: "候选" }),
      sheetSelection: () => ({ unitId: "unit", sheetId: "sheet0", range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 } }),
      documentSelection: () => ({ unitId: "unit", segmentId: "", start: 0, end: 8 }),
      snapshot: () => structuredClone(ports.data.snapshot), dispose: ports.dispose };
  });
  ports.load.mockResolvedValue({ mount: ports.mount });
});
afterEach(cleanup);

it("recovers pending text on Activity reconnect, displays IME separately and never inserts it automatically", async () => {
  const p = props(), renderEditor = mode => <Activity mode={mode}><NativeOfficeArtifactEditor {...p} /></Activity>;
  const view = render(renderEditor("visible"));
  await waitFor(() => expect(screen.getByRole("button", { name: "Save" }).disabled).toBe(false));
  act(() => { ports.pending = true; ports.options.onMutation(0); });
  view.rerender(renderEditor("hidden"));
  await waitFor(() => expect(inputDraft?.entries[0].text).toBe("Unconfirmed 中文"));
  ports.pending = false;
  view.rerender(renderEditor("visible"));
  expect((await screen.findByRole("textbox", { name: "Backup text" })).value).toBe("Unconfirmed 中文");
  expect(screen.getByRole("textbox", { name: "Composition backup" }).value).toBe("候选");
  expect(screen.getByRole("button", { name: "Save" }).disabled).toBe(true);
  expect(ports.data.snapshot.sheets.sheet0.cellData[0]?.[0]).toBeUndefined();
  expect(ports.api.mock.calls.some(([, options]) => options?.method === "PUT")).toBe(false);
  ports.writeInput.mockRejectedValueOnce(new Error("LOCAL_DRAFT_CAPACITY"));
  fireEvent.click(screen.getByRole("button", { name: "Continue and clear backups" }));
  await screen.findByRole("alert"); expect(screen.getByRole("textbox", { name: "Backup text" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Continue and clear backups" }));
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "Backup text" })).toBeNull());
  expect(inputDraft).toBeNull(); expect(screen.getByRole("button", { name: "Save" }).disabled).toBe(false);
});
const props = () => ({ userId: "u", artifactId: "a", kind: "sheet", zh: false, editorRef: createRef() });
const edit = value => { ports.data.snapshot.sheets.sheet0.cellData[0] = { 0: { v: value, t: 1 } }; ports.sequence++; ports.options.onMutation(ports.sequence); };

it("opens native XLSX lazily, refuses unfinished input, flushes edits and recovers the same export after a lost response", async () => {
  const api = ports.api.getMockImplementation(), submissions = [];
  ports.api.mockImplementation(async (path, options = {}) => {
    if (path.endsWith("/exports")) {
      if (options.method === "POST") { submissions.push(options.body); if (submissions.length === 1) throw new Error("network"); return { id: "export" }; }
      return { items: [], formats: [{ format: "xlsx", enabled: true }] };
    }
    return api(path, options);
  });
  render(<NativeOfficeArtifactEditor {...props()} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Export" }).disabled).toBe(false));
  expect(ports.api.mock.calls.some(([path]) => path.endsWith("/exports"))).toBe(false);
  act(() => { ports.pending = true; edit("Unconfirmed"); });
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Save and export XLSX" }).disabled).toBe(false));
  expect(screen.getByText(/unsupported content stop the export/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save and export XLSX" }));
  await screen.findByText(/Confirm the cell with Enter/); expect(submissions).toHaveLength(0);
  act(() => { ports.pending = false; edit("Confirmed export"); });
  fireEvent.click(screen.getByRole("button", { name: "Save and export XLSX" }));
  await waitFor(() => expect(submissions).toEqual([{ revision: 2, format: "xlsx" }]));
  const saved = ports.api.mock.calls.find(([, options]) => options?.method === "PUT")[1].body;
  expect(saved.content.snapshot.sheets.sheet0.cellData[0][0].v).toBe("Confirmed export");
  fireEvent.click(await screen.findByRole("button", { name: "Close export" }));
  act(() => edit("Later changes"));
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  fireEvent.click(await screen.findByRole("button", { name: "Recover submission" }));
  await waitFor(() => expect(submissions).toEqual([{ revision: 2, format: "xlsx" }, { revision: 2, format: "xlsx" }]));
  expect(ports.api.mock.calls.filter(([, options]) => options?.method === "PUT")).toHaveLength(1);
});

it("flushes native document edits before exporting DOCX and explains its actual feature boundaries", async () => {
  ports.kind = "document";
  const api = ports.api.getMockImplementation(); ports.api.mockImplementation(async (path, options) => path.endsWith("/exports") ? { formats: [{ format: "docx", enabled: true }], items: [] } : api(path, options));
  render(<NativeOfficeArtifactEditor {...props()} kind="document" />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Export" }).disabled).toBe(false));
  act(() => { ports.data.snapshot.body.dataStream = "Revised!\r\n"; ports.sequence++; ports.options.onMutation(ports.sequence); });
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Save and export DOCX" }).disabled).toBe(false));
  expect(screen.getByText(/Comments, floating images, merged table cells/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save and export DOCX" }));
  await waitFor(() => expect(ports.api.mock.calls.find(([, options]) => options?.method === "POST")?.[1].body).toEqual({ revision: 2, format: "docx" }));
  const saved = ports.api.mock.calls.find(([, options]) => options?.method === "PUT")[1].body;
  expect(saved.content.snapshot.body.dataStream).toBe("Revised!\r\n");
});

it("references native document text through the actual controller/session instead of the old block contract", async () => {
  ports.kind = "document";
  const onReference = vi.fn(); render(<NativeOfficeArtifactEditor {...props()} kind="document" onReference={onReference} canReferenceNative />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Reference selected text" }).disabled).toBe(false));
  act(() => { ports.data.snapshot.body.dataStream = "Revised!\r\n"; ports.sequence++; ports.options.onMutation(ports.sequence); });
  fireEvent.click(screen.getByRole("button", { name: "Reference selected text" }));
  await waitFor(() => expect(onReference).toHaveBeenCalledOnce());
  expect(onReference).toHaveBeenCalledWith(expect.objectContaining({ artifactId: "a", baseRevision: 2, format: "univer-document-1", unitId: "unit", segmentId: "", spans: [{ start: 0, end: 8, expectedText: "Revised!" }] }));
  expect(ports.api.mock.calls.some(([_path, options]) => options?.method === "PUT")).toBe(true);
});

it("references native cells only after saving confirmed edits and hides the action when admission is off", async () => {
  const p = props(), onReference = vi.fn(), view = render(<NativeOfficeArtifactEditor {...p} onReference={onReference} canReferenceNative />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Reference selected cells" }).disabled).toBe(false));
  act(() => edit("Confirmed"));
  fireEvent.click(screen.getByRole("button", { name: "Reference selected cells" }));
  await waitFor(() => expect(onReference).toHaveBeenCalledOnce());
  expect(onReference).toHaveBeenCalledWith(expect.objectContaining({ artifactId: "a", baseRevision: 2, unitId: "unit", format: "univer-sheet-1", cells: [{ row: 0, column: 0 }] }));
  expect(ports.api.mock.calls.some(([_path, options]) => options?.method === "PUT")).toBe(true);
  view.rerender(<NativeOfficeArtifactEditor {...p} onReference={onReference} canReferenceNative={false} />);
  expect(screen.queryByRole("button", { name: "Reference selected cells" })).toBeNull();
});

it("binds real API/journal/controller state, blocks unfinished inputs and saves the confirmed snapshot", async () => {
  const p = props(); render(<NativeOfficeArtifactEditor {...p} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Save" }).disabled).toBe(false));
  act(() => { ports.pending = true; edit("Unfinished"); });
  expect(screen.getByText(/Input awaiting confirmation/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Confirm the cell with Enter");
  expect(ports.api.mock.calls.some(([_path, options]) => options?.method === "PUT")).toBe(false);
  await act(async () => { ports.pending = false; edit("Confirmed 中文"); await p.editorRef.current.flush(); });
  const saved = ports.api.mock.calls.find(([_path, options]) => options?.method === "PUT")[1].body;
  expect(saved.content.snapshot.sheets.sheet0.cellData[0][0].v).toBe("Confirmed 中文");
  expect(draft.dirty).toBe(false);
});

it("shows conflict recovery and opens the confirmed copy instead of invoking legacy AI/export actions", async () => {
  const local = native(); local.snapshot.sheets.sheet0.cellData = { 0: { 0: { v: "Local", t: 1 } } };
  draft = { draftVersion: "univer-1", artifactId: "a", baseRevision: 1, content: local, generation: 1, savedGeneration: 0, inflight: null, inflightGeneration: null, copyRequest: null, dirty: true };
  ports.api.mockImplementation(async path => path.endsWith("/copy") ? { artifactId: "copy", revision: 1 } : { id: "a", revision: 2, content: native() });
  const onOpenArtifact = vi.fn(), onArtifactCreated = vi.fn();
  render(<NativeOfficeArtifactEditor {...props()} onOpenArtifact={onOpenArtifact} onArtifactCreated={onArtifactCreated} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Keep edits as a copy" }).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Keep edits as a copy" }));
  fireEvent.click(await screen.findByRole("button", { name: "Open copy" }));
  expect(onOpenArtifact).toHaveBeenCalledWith("copy"); expect(onArtifactCreated).toHaveBeenCalledWith({ artifactId: "copy", revision: 1 });
  expect(screen.queryByRole("button", { name: "Export" })).toBeNull();
});

it("persists before Activity disposal and restores the draft on reconnection with a new engine", async () => {
  const p = props(), view = render(<Activity mode="visible"><NativeOfficeArtifactEditor {...p} /></Activity>);
  await waitFor(() => expect(screen.getByRole("button", { name: "Save" }).disabled).toBe(false));
  act(() => edit("Reconnect me"));
  view.rerender(<Activity mode="hidden"><NativeOfficeArtifactEditor {...p} /></Activity>);
  await waitFor(() => expect(ports.dispose).toHaveBeenCalledOnce());
  expect(draft.content.snapshot.sheets.sheet0.cellData[0][0].v).toBe("Reconnect me");
  view.rerender(<Activity mode="visible"><NativeOfficeArtifactEditor {...p} /></Activity>);
  await waitFor(() => expect(ports.mount).toHaveBeenCalledTimes(2));
  expect(ports.options.snapshot.sheets.sheet0.cellData[0][0].v).toBe("Reconnect me");
});

it("recovers an interrupted reference flush on Activity reconnect without retaining the old busy state or emitting a stale selection", async () => {
  ports.kind = "document";
  const p = { ...props(), kind: "document", canReferenceNative: true, onReference: vi.fn() };
  const renderEditor = mode => <Activity mode={mode}><NativeOfficeArtifactEditor {...p} /></Activity>;
  const view = render(renderEditor("visible"));
  await waitFor(() => expect(screen.getByRole("button", { name: "Reference selected text" }).disabled).toBe(false));
  const api = ports.api.getMockImplementation(); let finish;
  ports.api.mockImplementation((path, options = {}) => {
    if (options.method === "PUT" && !finish) return new Promise(resolve => { finish = () => resolve({ artifactId: "a", baseRevision: options.body.baseRevision, revision: options.body.baseRevision + 1 }); });
    if (!options.method) return Promise.resolve({ id: "a", revision: 2, content: { ...native(), snapshot: { ...native().snapshot, body: { ...native().snapshot.body, dataStream: "Revised!\r\n" } } } });
    return api(path, options);
  });
  act(() => { ports.data.snapshot.body.dataStream = "Revised!\r\n"; ports.sequence++; ports.options.onMutation(ports.sequence); });
  fireEvent.click(screen.getByRole("button", { name: "Reference selected text" }));
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  view.rerender(renderEditor("hidden")); view.rerender(renderEditor("visible"));
  await waitFor(() => expect(ports.mount).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByRole("button", { name: "Reference selected text" }).disabled).toBe(false));
  await act(async () => finish()); expect(p.onReference).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Reference selected text" }));
  await waitFor(() => expect(p.onReference).toHaveBeenCalledOnce());
  expect(p.onReference.mock.calls[0][0].baseRevision).toBe(2);
});

it("warns before browser unload only while work is unconfirmed, and removes the listener on unmount", async () => {
  const p = props(), view = render(<NativeOfficeArtifactEditor {...p} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Save" }).disabled).toBe(false));
  const before = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(before); expect(before.defaultPrevented).toBe(false);
  act(() => { ports.pending = true; ports.options.onMutation(ports.sequence); });
  const dirty = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(dirty); expect(dirty.defaultPrevented).toBe(true);
  view.unmount(); const after = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(after); expect(after.defaultPrevented).toBe(false);
});
