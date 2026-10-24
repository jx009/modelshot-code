import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createNativeOfficeController } from "../../src/lib/creation/client/native-office-controller.js";
import { createNativeOfficeJournal } from "../../src/lib/creation/client/native-office-journal.js";
import { toNativeSheetArtifact } from "../../src/lib/creation/native-sheet-adapter.js";
import { toNativeDocumentArtifact } from "../../src/lib/creation/native-document-adapter.js";

const content = () => toNativeSheetArtifact({ schemaVersion: 1, kind: "sheet", title: "Budget", sheets: [{ id: "s", name: "Sheet", cells: [] }] }, "unit");
const document = (text = "Original") => toNativeDocumentArtifact({ schemaVersion: 1, kind: "document", title: "Report", sections: [{ id: "s", title: "Section", blocks: [{ id: "p", type: "paragraph", runs: [{ text, marks: { bold: true } }] }] }] }, "unit");
function setup(kind = "sheet", inputDraft = null) {
  const initial = () => kind === "sheet" ? content() : document();
  const value = { inputDraft, inputText: "Unconfirmed", draft: null, data: initial(), sequence: 0, pending: false, options: null, revision: 1, controller: null };
  const writeDraft = vi.fn(async draft => { value.draft = structuredClone(draft); });
  const save = vi.fn(async body => ({ artifactId: "a", baseRevision: body.baseRevision, revision: ++value.revision }));
  const copy = vi.fn(async () => ({ artifactId: "copy", revision: 1 }));
  const journal = createNativeOfficeJournal({ artifactId: "a", readDraft: async () => value.draft, writeDraft,
    load: async () => ({ id: "a", revision: value.revision, content: initial() }), save, copy, requestKey: () => crypto.randomUUID(), onState: () => value.controller?.changed() });
  const writeInputDraft = vi.fn(async (draft, prepare) => { await prepare?.(); value.inputDraft = structuredClone(draft); });
  const session = { ...journal, readInputDraft: async () => value.inputDraft, writeInputDraft };
  const engine = { get sequence() { return value.sequence; }, isInputPending: () => value.pending,
    pendingInput: () => ({ unitId: "unit", sheetId: "sheet0", row: 0, column: 0, text: value.inputText, composing: false, compositionText: "" }),
    sheetSelection: vi.fn(() => ({ unitId: "unit", sheetId: "sheet0", range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 } })),
    documentSelection: vi.fn(() => ({ unitId: "unit", segmentId: "", start: 0, end: 8 })),
    snapshot: vi.fn(() => structuredClone(value.data.snapshot)), dispose: vi.fn() };
  const runtime = { mount: vi.fn(async options => { value.options = options; return engine; }) };
  const loadRuntime = vi.fn(async () => runtime), onState = vi.fn(), onError = vi.fn(), container = {};
  const controller = createNativeOfficeController({ session, loadRuntime, container, kind, locale: "en", onState, onError });
  value.controller = controller;
  const edit = text => { if (kind === "sheet") value.data.snapshot.sheets.sheet0.cellData[0] = { 0: { v: text, t: 1 } }; else value.data = document(text); value.sequence++; value.options.onMutation(value.sequence); };
  return { value, writeInputDraft, session, engine, runtime, loadRuntime, controller, writeDraft, save, copy, onState, onError, edit, container };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("backs up unfinished input without workbook snapshots and blocks replay until the user reviews it", async () => {
  const t = setup(); await t.controller.open(); t.value.pending = true;
  for (let index = 0; index < 500; index++) { t.value.inputText = `Pending ${index}`; t.value.options.onMutation(0); }
  expect(t.writeInputDraft).not.toHaveBeenCalled(); expect(t.onState.mock.calls.length).toBeLessThan(10);
  await vi.advanceTimersByTimeAsync(800);
  expect(t.writeInputDraft).toHaveBeenCalledOnce(); expect(t.engine.snapshot).not.toHaveBeenCalled(); expect(t.save).not.toHaveBeenCalled();
  expect(t.value.inputDraft.entries[0].text).toBe("Pending 499");
  t.value.inputText = "Final unconfirmed"; t.controller.dispose(); await vi.advanceTimersByTimeAsync(0);
  const u = setup("sheet", t.value.inputDraft); await u.controller.open();
  expect(u.container.inert).toBe(true);
  expect(u.onState.mock.lastCall[0].recoveredInputs[0].text).toBe("Final unconfirmed");
  await expect(u.controller.flush()).rejects.toThrow("NATIVE_OFFICE_INPUT_RECOVERY_REQUIRED");
  expect(u.save).not.toHaveBeenCalled();
  u.writeInputDraft.mockRejectedValueOnce(new Error("quota"));
  await expect(u.controller.dismissRecoveredInputs()).rejects.toThrow("quota"); expect(u.container.inert).toBe(true);
  await u.controller.dismissRecoveredInputs(); expect(u.container.inert).toBe(false); expect(u.value.inputDraft).toBeNull();
  u.controller.dispose();
});

it("keeps a backup until the matching confirmed workbook draft is stored", async () => {
  const t = setup(); await t.controller.open(); t.value.pending = true; t.value.inputText = "Confirmed 中文";
  await t.controller.persist(); expect(t.value.inputDraft.entries[0].text).toBe("Confirmed 中文");
  t.value.pending = false; t.edit("Confirmed 中文");
  t.writeDraft.mockRejectedValueOnce(new Error("quota")); await t.controller.persist();
  expect(t.value.inputDraft.entries[0].text).toBe("Confirmed 中文");
  await t.controller.persist(); expect(t.value.inputDraft).toBeNull();
  expect(t.value.draft.content.snapshot.sheets.sheet0.cellData[0][0].v).toBe("Confirmed 中文");
  t.controller.dispose();
});

it("reads native document selection only on explicit reference and waits for its confirmed snapshot", async () => {
  const t = setup("document"); await t.controller.open(); t.edit("Revised!");
  expect(t.engine.documentSelection).not.toHaveBeenCalled(); expect(t.engine.snapshot).not.toHaveBeenCalled();
  const promise = t.controller.reference(); await vi.advanceTimersByTimeAsync(0);
  expect(await promise).toEqual({ format: "univer-document-1", unitId: "unit", segmentId: "", spans: [{ start: 0, end: 8, expectedText: "Revised!" }], baseRevision: 2 });
  expect(t.save).toHaveBeenCalledOnce(); expect(t.engine.sheetSelection).not.toHaveBeenCalled();
  t.value.pending = true;
  await expect(t.controller.reference()).rejects.toThrow("NATIVE_OFFICE_INPUT_PENDING");
  t.value.pending = false; t.controller.dispose();
});

it("captures an explicit selection before save and requires a fresh reference when edits arrive during the flush", async () => {
  const t = setup(); await t.controller.open();
  expect(t.engine.sheetSelection).not.toHaveBeenCalled();
  t.edit("Amount");
  const referencing = t.controller.reference(); await vi.advanceTimersByTimeAsync(0);
  expect(await referencing).toMatchObject({ format: "univer-sheet-1", unitId: "unit", sheetId: "sheet0", cells: [{ row: 0, column: 0 }], baseRevision: 2 });
  expect(t.save).toHaveBeenCalledOnce();
  let acknowledge;
  t.save.mockImplementationOnce(body => new Promise(resolve => { acknowledge = () => resolve({ artifactId: "a", baseRevision: body.baseRevision, revision: ++t.value.revision }); }));
  t.edit("Before save");
  const changed = expect(t.controller.reference()).rejects.toThrow("LANGUAGE_SELECTION_CHANGED"); await vi.advanceTimersByTimeAsync(0);
  t.edit("Shifted coordinates"); acknowledge(); await changed;
  t.value.pending = true; await expect(t.controller.reference()).rejects.toThrow("NATIVE_OFFICE_INPUT_PENDING");
  t.value.pending = false; t.controller.dispose();
});

it("mounts once, coalesces typing snapshots and saves through the durable session after a pause", async () => {
  const t = setup(); await t.controller.open();
  for (let i = 0; i < 500; i++) t.edit(`Text ${i}`);
  expect(t.engine.snapshot).not.toHaveBeenCalled(); expect(t.save).not.toHaveBeenCalled();
  // Readiness + one dirty transition, not a React update for every key.
  expect(t.onState.mock.calls.length).toBeLessThan(10);
  await vi.advanceTimersByTimeAsync(800);
  expect(t.engine.snapshot).toHaveBeenCalledOnce(); expect(t.writeDraft).toHaveBeenCalledOnce();
  expect(t.value.draft.content.snapshot.sheets.sheet0.cellData[0][0].v).toBe("Text 499");
  await vi.advanceTimersByTimeAsync(4201);
  expect(t.save).toHaveBeenCalledOnce(); expect(t.controller.hasUnsaved()).toBe(false);
  t.controller.dispose(); expect(t.engine.dispose).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});

it("never snapshots an active cell/IME or reports it saved when switching files", async () => {
  const t = setup(); await t.controller.open(); t.value.pending = true; t.edit("unfinished");
  await vi.advanceTimersByTimeAsync(5001);
  expect(t.engine.snapshot).not.toHaveBeenCalled(); expect(t.controller.hasUnsaved()).toBe(true);
  const saving = expect(t.controller.flush()).rejects.toThrow("NATIVE_OFFICE_INPUT_PENDING");
  await vi.advanceTimersByTimeAsync(0); await saving; expect(t.save).not.toHaveBeenCalled();
  t.value.pending = false; t.edit("Confirmed 中文");
  const finished = t.controller.flush(); await vi.advanceTimersByTimeAsync(0); await finished;
  expect(t.save.mock.calls[0][0].content.snapshot.sheets.sheet0.cellData[0][0].v).toBe("Confirmed 中文");
  expect(t.controller.hasUnsaved()).toBe(false); t.controller.dispose();
});

it("captures edits made during a network save before resolving a navigation flush", async () => {
  const t = setup(); await t.controller.open(); t.edit("First");
  let acknowledge;
  t.save.mockImplementationOnce(body => new Promise(resolve => { acknowledge = () => resolve({ artifactId: "a", baseRevision: body.baseRevision, revision: ++t.value.revision }); }));
  const saving = t.controller.flush(); await vi.advanceTimersByTimeAsync(0);
  t.edit("Second"); acknowledge(); await saving;
  expect(t.save).toHaveBeenCalledTimes(2);
  expect(t.save.mock.calls[1][0].baseRevision).toBe(2);
  expect(t.save.mock.calls[1][0].content.snapshot.sheets.sheet0.cellData[0][0].v).toBe("Second");
  expect(t.controller.hasUnsaved()).toBe(false); t.controller.dispose();
});

it("retains edits arriving during a rejected save in a conflict copy without overwriting cloud data", async () => {
  const t = setup(); await t.controller.open(); t.edit("First");
  let reject;
  t.save.mockImplementationOnce(() => new Promise((_resolve, failure) => { reject = failure; }));
  const failed = expect(t.controller.flush()).rejects.toThrow("ARTIFACT_VERSION_CONFLICT"); await vi.advanceTimersByTimeAsync(0);
  t.edit("During save"); reject(new Error("ARTIFACT_VERSION_CONFLICT")); await failed;
  t.edit("Final local"); await vi.advanceTimersByTimeAsync(800);
  expect(t.session.getState().status).toBe("conflict");
  const result = await t.controller.copy("Local copy");
  expect(result.artifactId).toBe("copy"); expect(t.save).toHaveBeenCalledOnce();
  expect(t.copy.mock.calls[0][0].content.snapshot.sheets.sheet0.cellData[0][0].v).toBe("Final local");
  expect(t.controller.hasUnsaved()).toBe(false); expect(t.container.inert).toBe(true);
  expect(await t.controller.flush()).toEqual(result); t.controller.dispose();
});

it("reserves an unmount draft before closing and never mounts after a cancelled runtime load", async () => {
  const t = setup(); await t.controller.open(); t.edit("Last edit"); t.controller.dispose();
  expect(t.writeDraft).toHaveBeenCalledOnce(); expect(t.value.draft.content.snapshot.sheets.sheet0.cellData[0][0].v).toBe("Last edit");
  t.controller.dispose(); expect(t.engine.dispose).toHaveBeenCalledOnce();
  const u = setup(); let resolve;
  u.loadRuntime.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const opening = u.controller.open(); await vi.advanceTimersByTimeAsync(0); u.controller.dispose(); resolve(u.runtime); await opening;
  expect(u.runtime.mount).not.toHaveBeenCalled();
});

it("does not retry quota/network failures in a background loop", async () => {
  const t = setup(); await t.controller.open(); t.writeDraft.mockRejectedValue(new Error("LOCAL_DRAFT_CAPACITY")); t.edit("Keep me");
  await vi.advanceTimersByTimeAsync(6000); const calls = t.writeDraft.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60000);
  expect(t.save).not.toHaveBeenCalled(); expect(t.writeDraft).toHaveBeenCalledTimes(calls);
  expect(t.controller.hasUnsaved()).toBe(true); expect(t.onError).toHaveBeenCalled(); t.controller.dispose();
});
