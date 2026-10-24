import { afterEach, expect, it, vi } from "vitest";
import { startNativeOfficeEngine } from "../../src/lib/creation/client/native-office-engine.js";
import { createNativeFormulaWorker } from "../../src/lib/creation/client/univer-worker-lifetime.js";

afterEach(() => vi.useRealTimers());
function setup() {
  const handlers = [], saved = { id: "unit", name: "Test", custom: { value: 1 } };
  const unit = { save: vi.fn(() => saved), dispose: vi.fn(), isCellEditing: vi.fn(() => false), getActiveRange: vi.fn(() => ({ getSheetId: () => "sheet0", getRange: () => ({ startRow: 1, endRow: 2, startColumn: 3, endColumn: 4 }) })) };
  const subscription = { dispose: vi.fn() }, engine = { registerPlugin: vi.fn(), dispose: vi.fn() };
  const api = { Event: { CommandExecuted: "executed" }, createWorkbook: vi.fn(() => unit), createDocument: vi.fn(() => unit), disposeUnit: vi.fn(), dispose: vi.fn(), addEvent: vi.fn((_event, fn) => { handlers.push(fn); return subscription; }) };
  const library = { Univer: vi.fn(function () { return engine; }), FUniver: { newAPI: vi.fn(() => api) }, LogLevel: { WARN: 2 }, CommandType: { MUTATION: 2 } };
  const workerLease = { worker: {}, dispose: vi.fn() }, onMutation = vi.fn(), onError = vi.fn(), preset = vi.fn(() => ({ plugins: ["first", ["second", { option: true }]] }));
  const controller = new AbortController();
  const options = { library, preset, kind: "sheet", snapshot: { id: "unit", custom: { value: 1 } }, container: {}, locale: "zhCN", localePack: {}, workerLease, onMutation, onError, signal: controller.signal };
  return { handlers, saved, unit, subscription, engine, api, library, workerLease, onMutation, onError, preset, controller, options };
}

it("does not dirty the workbook for formula transport messages but retains actual cell/formula edits", () => {
  const value = setup(), lifetime = startNativeOfficeEngine(value.options), event = value.handlers[0];
  for (let index = 0; index < 100; index++) for (const suffix of ["set-trigger-formula-calculation-start", "set-formula-calculation-start", "set-formula-calculation-stop", "set-formula-calculation-notification", "set-formula-calculation-result", "set-formula-string-batch-calculation", "set-formula-string-batch-calculation-result"]) {
    event({ id: `formula.mutation.${suffix}`, type: 2, params: {} });
  }
  event({ id: "formula.mutation.set-array-formula-data", type: 2, options: { onlyLocal: true, fromSync: true } });
  event({ id: "sheet.mutation.set-range-values", type: 2, params: { unitId: "unit" }, options: { onlyLocal: true, fromSync: true, fromFormula: true, applyFormulaCalculationResult: true } });
  expect(lifetime.sequence).toBe(0); expect(value.onMutation).not.toHaveBeenCalled(); expect(value.unit.save).not.toHaveBeenCalled();
  event({ id: "sheet.mutation.set-range-values", type: 2, params: { unitId: "unit" } });
  event({ id: "formula.mutation.set-formula-data", type: 2, params: { unitId: "unit" } });
  event({ id: "formula.mutation.set-array-formula-data", type: 2, params: { unitId: "unit" } });
  event({ id: "sheet.mutation.set-range-values", type: 2, params: { unitId: "unit" }, options: { onlyLocal: true, fromFormula: true } });
  expect(lifetime.sequence).toBe(4); expect(value.onMutation).toHaveBeenCalledTimes(4);
  lifetime.dispose();
});

it("counts mutations without taking snapshots for selection/scroll/typing and disposes all owned resources once", async () => {
  const value = setup(), lifetime = startNativeOfficeEngine(value.options), event = value.handlers[0];
  expect(value.preset).toHaveBeenCalledWith({ container: value.options.container, disableAutoFocus: true, workerURL: value.workerLease.worker });
  expect(value.library.Univer.mock.calls[0][0].undoRedoHistoryLimit).toBe(50);
  expect(value.api.createWorkbook.mock.calls[0][0]).not.toBe(value.options.snapshot);
  value.api.createWorkbook.mock.calls[0][0].custom.value = 99;
  expect(value.options.snapshot.custom.value).toBe(1);
  for (let index = 0; index < 500; index++) event({ type: 1, params: { unitId: "unit" } });
  event({ type: 2, params: { unitId: "other" } });
  expect(lifetime.sequence).toBe(0);
  for (let index = 0; index < 10; index++) event({ type: 2, params: { unitId: "unit" } });
  expect(lifetime.sequence).toBe(10); expect(value.onMutation).toHaveBeenCalledTimes(10);
  expect(value.unit.save).not.toHaveBeenCalled();
  expect(value.unit.getActiveRange).not.toHaveBeenCalled();
  expect(lifetime.sheetSelection()).toEqual({ unitId: "unit", sheetId: "sheet0", range: { startRow: 1, endRow: 2, startColumn: 3, endColumn: 4 } });
  expect(value.unit.save).not.toHaveBeenCalled();
  const snapshot = lifetime.snapshot(); snapshot.custom.value = 2;
  expect(value.saved.custom.value).toBe(1);
  value.controller.abort(); lifetime.dispose();
  expect(value.workerLease.dispose).toHaveBeenCalledOnce(); expect(value.engine.dispose).not.toHaveBeenCalled();
  await Promise.resolve();
  for (const port of [value.subscription, value.unit, value.api, value.engine, value.workerLease]) expect(port.dispose).toHaveBeenCalledOnce();
  expect(value.api.disposeUnit).toHaveBeenCalledExactlyOnceWith("unit");
  event({ type: 2, params: { unitId: "unit" } });
  expect(lifetime.sequence).toBe(10);
  expect(() => lifetime.snapshot()).toThrow("ARTIFACT_CLOSED");
});

it("releases the engine and worker when registration or unit creation fails", async () => {
  for (const stage of ["register", "unit"]) {
    const value = setup();
    (stage === "register" ? value.engine.registerPlugin : value.api.createWorkbook).mockImplementation(() => { throw new Error("plugin failed"); });
    expect(() => startNativeOfficeEngine(value.options)).toThrow("plugin failed");
    await Promise.resolve();
    expect(value.engine.dispose).toHaveBeenCalledOnce(); expect(value.workerLease.dispose).toHaveBeenCalledOnce();
  }
});

it("isolates a replacement mount from deferred vendor teardown and still releases after a disposal failure", async () => {
  const { JSDOM } = await import("jsdom"), dom = new JSDOM("<div id='host'></div>");
  const host = dom.window.document.getElementById("host"), first = setup(), second = setup();
  const old = startNativeOfficeEngine({ ...first.options, container: host });
  const oldMount = first.preset.mock.calls[0][0].container;
  first.unit.dispose.mockImplementation(() => { throw new Error("vendor unit failed"); });
  first.engine.dispose.mockImplementation(() => oldMount.replaceChildren());
  old.dispose();
  expect(oldMount.isConnected).toBe(false); expect(first.workerLease.dispose).toHaveBeenCalledOnce();
  const next = startNativeOfficeEngine({ ...second.options, container: host });
  const newMount = second.preset.mock.calls[0][0].container;
  newMount.textContent = "New editor";
  await Promise.resolve();
  expect(first.engine.dispose).toHaveBeenCalledOnce(); expect(first.onError).toHaveBeenCalledOnce();
  expect(newMount.isConnected).toBe(true); expect(host.textContent).toBe("New editor");
  next.dispose(); await Promise.resolve(); dom.window.close();
});

it("reads the pinned document selection service only on demand and refuses reads after disposal", () => {
  const value = setup(); value.options.kind = "document";
  value.options.readDocumentSelection = vi.fn(() => ({ unitId: "unit", segmentId: "header1", start: 2, end: 10 }));
  const lifetime = startNativeOfficeEngine(value.options);
  expect(value.options.readDocumentSelection).not.toHaveBeenCalled();
  expect(lifetime.documentSelection()).toEqual({ unitId: "unit", segmentId: "header1", start: 2, end: 10 });
  expect(value.options.readDocumentSelection).toHaveBeenCalledWith(value.engine);
  expect(value.unit.save).not.toHaveBeenCalled(); lifetime.dispose();
  expect(() => lifetime.documentSelection()).toThrow("ARTIFACT_CLOSED");
});

it("exposes composition and cell-edit barriers without saving on input and removes DOM listeners on disposal", () => {
  const value = setup(), doc = new EventTarget();
  value.options.container = { ownerDocument: doc, contains: target => target === doc };
  const lifetime = startNativeOfficeEngine(value.options);
  expect(lifetime.isInputPending()).toBe(false);
  doc.dispatchEvent(new Event("compositionstart")); expect(lifetime.isInputPending()).toBe(true);
  doc.dispatchEvent(new Event("input")); expect(value.unit.save).not.toHaveBeenCalled();
  doc.dispatchEvent(new Event("compositionend")); expect(lifetime.isInputPending()).toBe(false);
  value.unit.isCellEditing.mockReturnValue(true); expect(lifetime.isInputPending()).toBe(true);
  expect(lifetime.sequence).toBe(0);
  lifetime.dispose(); value.onMutation.mockClear();
  for (const type of ["compositionstart", "input", "compositionend"]) doc.dispatchEvent(new Event(type));
  expect(value.onMutation).not.toHaveBeenCalled();
});

it("backs up owned IME composition separately without reading another editor or serializing the workbook", async () => {
  const { JSDOM } = await import("jsdom"), dom = new JSDOM("<div id='own'><textarea></textarea></div><div class='univer-other'><textarea></textarea></div>");
  const doc = dom.window.document, own = doc.querySelector("#own textarea"), foreign = doc.querySelector(".univer-other textarea");
  const t = setup(); t.unit.isCellEditing.mockReturnValue(true);
  const readPendingInput = vi.fn(() => ({ unitId: "unit", sheetId: "sheet", row: 0, column: 0, text: "已输入" }));
  const live = startNativeOfficeEngine({ ...t.options, container: doc.getElementById("own"), readPendingInput });
  const dispatch = (target, type, data = "") => target.dispatchEvent(new dom.window.CompositionEvent(type, { bubbles: true, data }));
  dispatch(foreign, "compositionstart"); dispatch(foreign, "compositionupdate", "私密文字");
  expect(live.pendingInput()).toMatchObject({ composing: false, compositionText: "" });
  dispatch(own, "compositionstart"); dispatch(own, "compositionupdate", "候选字");
  expect(live.pendingInput()).toMatchObject({ text: "已输入", composing: true, compositionText: "候选字" });
  dispatch(foreign, "compositionend"); expect(live.pendingInput().composing).toBe(true);
  dispatch(own, "compositionend"); expect(live.pendingInput().compositionText).toBe("");
  expect(t.unit.save).not.toHaveBeenCalled(); live.dispose(); await Promise.resolve(); dom.window.close();
});

it("keeps disposal failures from leaking other resources and starts documents without a formula worker", async () => {
  const value = setup(), lifetime = startNativeOfficeEngine({ ...value.options, kind: "document", workerLease: undefined });
  expect(value.api.createDocument).toHaveBeenCalledOnce(); expect(value.api.createWorkbook).not.toHaveBeenCalled();
  value.subscription.dispose.mockImplementation(() => { throw new Error("subscription failed"); });
  expect(() => lifetime.dispose()).toThrow("NATIVE_OFFICE_DISPOSE_FAILED");
  await Promise.resolve();
  expect(value.engine.dispose).toHaveBeenCalledOnce(); expect(value.api.disposeUnit).toHaveBeenCalledOnce();
  const invalid = setup(); invalid.controller.abort();
  expect(() => startNativeOfficeEngine(invalid.options)).toThrow();
  expect(invalid.library.Univer).not.toHaveBeenCalled(); expect(invalid.workerLease.dispose).toHaveBeenCalledOnce();
  const noWorker = setup(); expect(() => startNativeOfficeEngine({ ...noWorker.options, workerLease: undefined })).toThrow("NATIVE_OFFICE_WORKER_REQUIRED");
});

class TestWorker extends EventTarget {
  terminate = vi.fn();
  emit(type, data) { const event = new Event(type); Object.defineProperty(event, "data", { value: data }); this.dispatchEvent(event); }
}
it("waits for the local formula worker readiness handshake then terminates it exactly once on abort", async () => {
  const worker = new TestWorker(), controller = new AbortController(), onError = vi.fn();
  const waiting = createNativeFormulaWorker({ createWorker: () => worker, signal: controller.signal, onError });
  worker.emit("message", { type: "unrelated" });
  worker.emit("message", { type: "modelshot-univer-formula-ready-1" });
  const lease = await waiting;
  expect(lease.worker).toBe(worker); expect(worker.terminate).not.toHaveBeenCalled();
  controller.abort(); lease.dispose();
  expect(worker.terminate).toHaveBeenCalledOnce();
  worker.emit("error"); expect(onError).not.toHaveBeenCalled();
});

it("bounds worker startup and reports both startup and post-start failures without silent main-thread fallback", async () => {
  vi.useFakeTimers();
  const timeout = new TestWorker(), timed = createNativeFormulaWorker({ createWorker: () => timeout, timeoutMs: 100 });
  const rejected = expect(timed).rejects.toThrow("NATIVE_OFFICE_WORKER_TIMEOUT");
  await vi.advanceTimersByTimeAsync(100); await rejected;
  expect(timeout.terminate).toHaveBeenCalledOnce();
  const broken = new TestWorker(), failed = createNativeFormulaWorker({ createWorker: () => broken });
  broken.emit("error"); await expect(failed).rejects.toThrow("NATIVE_OFFICE_WORKER_FAILED");
  expect(broken.terminate).toHaveBeenCalledOnce();
  const live = new TestWorker(), onError = vi.fn(), running = createNativeFormulaWorker({ createWorker: () => live, onError });
  live.emit("message", { type: "modelshot-univer-formula-ready-1" });
  const lease = await running;
  live.emit("messageerror"); lease.dispose();
  expect(live.terminate).toHaveBeenCalledOnce(); expect(onError).toHaveBeenCalledOnce();
  expect(onError.mock.calls[0][0].message).toBe("NATIVE_OFFICE_WORKER_FAILED");
});

it("rejects a cancelled import/start without leaving a worker or timeout alive", async () => {
  vi.useFakeTimers();
  const controller = new AbortController(), worker = new TestWorker();
  const pending = createNativeFormulaWorker({ signal: controller.signal, createWorker: () => worker });
  controller.abort(new Error("cancelled")); await expect(pending).rejects.toThrow("cancelled");
  expect(worker.terminate).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  const factory = vi.fn();
  await expect(createNativeFormulaWorker({ signal: controller.signal, createWorker: factory })).rejects.toThrow("cancelled");
  expect(factory).not.toHaveBeenCalled();
});
