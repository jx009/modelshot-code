import { afterEach, expect, it, vi } from "vitest";
import { createRunStream } from "../../src/lib/domain/creation/event-stream.js";

afterEach(() => { vi.useRealTimers(); });
const decode = result => new TextDecoder().decode(result.value);
it("replays persisted events then settles a finished run", async () => {
  const unsubscribe = vi.fn();
  const db = { creationRun: { findFirst: vi.fn(async () => ({ eventSequence: 3, status: "succeeded" })) }, creationEvent: { findMany: vi.fn(async () => [
    { sequence: 2, type: "step.succeeded", payload: { stepId: "step" } }, { sequence: 3, type: "run.succeeded", payload: {} },
  ]) } };
  const reader = createRunStream("owner", "run", 1, new AbortController().signal, { db, subscribe: () => unsubscribe }).getReader();
  let text = "";
  for (;;) { const item = await reader.read(); if (item.done) break; text += decode(item); }
  expect(text).toContain("id: 2"); expect(text).toContain("id: 3"); expect(text).toContain("event: settled");
  expect(text).not.toContain("id: 1\n");
  expect(unsubscribe).toHaveBeenCalledOnce();
});
it("asks for a fresh snapshot when retention left a gap", async () => {
  const db = { creationRun: { findFirst: vi.fn(async () => ({ eventSequence: 10, status: "running" })) }, creationEvent: { findMany: vi.fn(async () => [{ sequence: 9, type: "step.succeeded", payload: {} }]) } };
  const reader = createRunStream("owner", "run", 1, new AbortController().signal, { db, subscribe: () => () => {} }).getReader();
  let text = "";
  for (;;) { const item = await reader.read(); if (item.done) break; text += decode(item); }
  expect(text).toContain("event: reset"); expect(text).not.toContain("id: 9");
});
it("keeps heartbeats free of database reads and disposes the subscription on abort", async () => {
  vi.useFakeTimers();
  const unsubscribe = vi.fn(), abort = new AbortController();
  const db = { creationRun: { findFirst: vi.fn(async () => ({ eventSequence: 0, status: "running" })) }, creationEvent: { findMany: vi.fn(async () => []) } };
  const reader = createRunStream("owner", "run", 0, abort.signal, { db, subscribe: () => unsubscribe }).getReader();
  await reader.read();
  await vi.advanceTimersByTimeAsync(15000);
  expect(decode(await reader.read())).toContain(": heartbeat");
  expect(db.creationRun.findFirst).toHaveBeenCalledOnce();
  abort.abort();
  expect((await reader.read()).done).toBe(true);
  expect(unsubscribe).toHaveBeenCalledOnce();
});
