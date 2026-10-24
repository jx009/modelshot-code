import { afterEach, expect, it, vi } from "vitest";
import { NATIVE_FORMULA_BUDGET_EVENT, observeNativeFormulaBudget } from "../../src/lib/creation/client/native-formula-budget.js";
import { createNativeFormulaWorker } from "../../src/lib/creation/client/univer-worker-lifetime.js";
import { Univer, ICommandService, CommandType } from "@univerjs/core";
import { FUniver } from "@univerjs/core/facade";

afterEach(() => vi.useRealTimers());
it("observes the installed core facade before the calculation command handler runs", async () => {
  const engine = new Univer(), api = FUniver.newAPI(engine), order = [];
  const commands = engine.__getInjector().get(ICommandService);
  const start = commands.registerCommand({ id: "formula.mutation.set-formula-calculation-start", type: CommandType.MUTATION, handler: () => { order.push("handler"); return true; } });
  const end = commands.registerCommand({ id: "formula.mutation.set-formula-calculation-notification", type: CommandType.MUTATION, handler: () => true });
  const observer = observeNativeFormulaBudget(api, event => order.push(event.active ? "budget-start" : "budget-end"));
  try {
    await api.executeCommand("formula.mutation.set-formula-calculation-start", {});
    await api.executeCommand("formula.mutation.set-formula-calculation-notification", { functionsExecutedState: 3 });
    expect(order).toEqual(["budget-start", "handler", "budget-end"]);
  } finally { observer.dispose(); start.dispose(); end.dispose(); api.dispose(); engine.dispose(); }
});
class TestWorker extends EventTarget {
  terminate = vi.fn();
  emit(data) { const event = new Event("message"); Object.defineProperty(event, "data", { value: data }); this.dispatchEvent(event); }
}
it("starts before computation, preserves overlapping batch/workbook work and ignores progress notifications", () => {
  const callbacks = {}, disposal = [], post = vi.fn();
  const api = { Event: { BeforeCommandExecute: "before", CommandExecuted: "after" }, addEvent: (name, handler) => { callbacks[name] = handler; const dispose = vi.fn(); disposal.push(dispose); return { dispose }; } };
  const listener = observeNativeFormulaBudget(api, post), command = name => ({ id: `formula.mutation.${name}` });
  callbacks.before(command("set-formula-calculation-start"));
  callbacks.before(command("set-formula-calculation-start"));
  callbacks.before(command("set-formula-string-batch-calculation"));
  callbacks.after({ ...command("set-formula-calculation-notification"), params: { stageInfo: { stage: 4 } } });
  callbacks.after({ ...command("set-formula-calculation-notification"), params: { functionsExecutedState: 3 } });
  expect(post.mock.calls.map(([value]) => value.active)).toEqual([true, true, true]);
  callbacks.after(command("set-formula-string-batch-calculation-result"));
  expect(post.mock.calls.at(-1)[0]).toEqual({ type: NATIVE_FORMULA_BUDGET_EVENT, active: false });
  listener.dispose(); disposal.forEach(dispose => expect(dispose).toHaveBeenCalledOnce());
});

it("terminates a stuck worker on the main-thread budget even when it keeps reporting activity", async () => {
  vi.useFakeTimers(); const worker = new TestWorker(), onError = vi.fn();
  const start = createNativeFormulaWorker({ createWorker: () => worker, calculationTimeoutMs: 100, onError });
  worker.emit({ type: "modelshot-univer-formula-ready-1" }); const lease = await start;
  worker.emit({ type: NATIVE_FORMULA_BUDGET_EVENT, active: true });
  await vi.advanceTimersByTimeAsync(80); worker.emit({ type: NATIVE_FORMULA_BUDGET_EVENT, active: true });
  await vi.advanceTimersByTimeAsync(20);
  expect(worker.terminate).toHaveBeenCalledOnce(); expect(onError.mock.calls[0][0].message).toBe("NATIVE_OFFICE_CALCULATION_TIMEOUT");
  worker.emit({ type: NATIVE_FORMULA_BUDGET_EVENT, active: true }); lease.dispose();
  expect(onError).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});

it("allows idle workers and independent completed calculations without accumulating timers", async () => {
  vi.useFakeTimers(); const worker = new TestWorker(), onError = vi.fn(), abort = new AbortController();
  const start = createNativeFormulaWorker({ createWorker: () => worker, calculationTimeoutMs: 100, onError, signal: abort.signal });
  worker.emit({ type: "modelshot-univer-formula-ready-1" }); await start;
  await vi.advanceTimersByTimeAsync(60000); expect(worker.terminate).not.toHaveBeenCalled();
  for (let index = 0; index < 3; index++) {
    worker.emit({ type: NATIVE_FORMULA_BUDGET_EVENT, active: true }); await vi.advanceTimersByTimeAsync(80);
    worker.emit({ type: NATIVE_FORMULA_BUDGET_EVENT, active: false }); await vi.advanceTimersByTimeAsync(80);
  }
  expect(worker.terminate).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled();
  worker.emit({ type: NATIVE_FORMULA_BUDGET_EVENT, active: true }); abort.abort();
  expect(worker.terminate).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});
