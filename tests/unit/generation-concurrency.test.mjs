import { expect, it, vi } from "vitest";
import { ConcurrencyGate } from "../../src/lib/infra/concurrency.js";
import { executionDefaults, executionSchema } from "../../src/lib/infra/execution-config.js";
import { dispatchOutbox } from "../../src/lib/infra/queue/index.js";
it("defaults model work to 128, independent of legacy WORKER_CONCURRENCY=2", () => {
  expect(executionDefaults({ WORKER_CONCURRENCY: "2" })).toEqual({ generationConcurrency: 128, transferConcurrency: 8, processingConcurrency: 4 });
  expect(executionSchema.parse({ generationConcurrency: 256, transferConcurrency: 12, processingConcurrency: 4 }).generationConcurrency).toBe(256);
});
it("dispatches models separately from exports, payments and COS mirrors", async () => {
  const events = ["generate", "export", "payment", "asset-mirror"].map((kind, id) => ({ id: String(id), kind, entityId: "task" }));
  const db = { outboxEvent: { findMany: vi.fn(async () => events), update: vi.fn(), updateMany: vi.fn() } };
  const main = { add: vi.fn() }, models = { add: vi.fn() }, images = { add: vi.fn() };
  await dispatchOutbox(db, main, 500, images, models);
  expect(models.add.mock.calls.map(args => args[0])).toEqual(["generate"]);
  expect(main.add.mock.calls.map(args => args[0])).toEqual(["export", "payment"]);
  expect(images.add.mock.calls.map(args => args[0])).toEqual(["asset-mirror"]);
});
it("bounds transfers independently and releases slots after errors and runtime changes", async () => {
  const gate = new ConcurrencyGate(2), releases = [];
  let active = 0, peak = 0;
  const tasks = Array.from({ length: 10 }, (_, index) => gate.run(async () => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => releases.push(resolve)); active--;
    if (index === 0) throw new Error("transfer failed");
  }).catch(() => {}));
  await vi.waitFor(() => expect(releases).toHaveLength(2));
  expect(peak).toBe(2); gate.setLimit(4);
  await vi.waitFor(() => expect(releases).toHaveLength(4));
  for (let i = 0; i < 10; i++) { await vi.waitFor(() => expect(releases[i]).toBeTypeOf("function")); releases[i](); }
  await Promise.all(tasks); expect(peak).toBe(4); expect(gate.active).toBe(0);
});
