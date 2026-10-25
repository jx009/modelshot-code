// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCreationRun } from "../../src/components/creation/useCreationRun";

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("../../src/lib/client-api", () => ({ api: (...args) => mocks.api(...args) }));
let source;
beforeEach(() => {
  vi.useFakeTimers(); mocks.api.mockReset();
  vi.stubGlobal("EventSource", class {
    constructor() { source = this; this.listeners = {}; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    close() {}
    emit(name, data) { this.listeners[name]?.({ data: JSON.stringify(data) }); }
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const run = (sequence, status = "running") => ({ id: "run", status, eventSequence: sequence, steps: [] });
it("reconciles a silent SSE connection and stops polling when finished", async () => {
  mocks.api.mockResolvedValueOnce(run(1)).mockResolvedValue(run(2, "succeeded"));
  renderHook(() => useCreationRun("run"));
  await act(async () => {});
  expect(mocks.api).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(20000));
  expect(mocks.api).toHaveBeenCalledTimes(2);
  await act(async () => vi.advanceTimersByTimeAsync(40000));
  expect(mocks.api).toHaveBeenCalledTimes(2);
});
it("immediately follows up an event received during an in-flight status read", async () => {
  let resolve;
  mocks.api.mockResolvedValueOnce(run(1)).mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockResolvedValue(run(3));
  renderHook(() => useCreationRun("run"));
  await act(async () => {});
  act(() => source.emit("creation", { sequence: 2 }));
  await act(async () => vi.advanceTimersByTimeAsync(80));
  act(() => source.emit("creation", { sequence: 3 }));
  await act(async () => resolve(run(2)));
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(mocks.api).toHaveBeenCalledTimes(3);
});
