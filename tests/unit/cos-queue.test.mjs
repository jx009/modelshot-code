import { expect, it, vi } from "vitest";
import { dispatchOutbox } from "../../src/lib/infra/queue/index.js";
import { scheduleCosRemoval, processCosRemoval } from "../../src/lib/domain/assets/cos-delivery.js";
import { COS_DEFAULTS } from "../../src/lib/infra/storage/cos-config.js";

it("dispatches image uploads and deletions to a separate durable queue", async () => {
  const events = ["generate", "asset-mirror", "asset-mirror-delete", "inspiration-mirror"].map((kind, i) => ({ id: String(i), entityId: "asset", kind }));
  const db = { outboxEvent: { findMany: vi.fn(async () => events), update: vi.fn(), updateMany: vi.fn() } };
  const generation = { add: vi.fn() }, mirror = { add: vi.fn() };
  expect(await dispatchOutbox(db, generation, 100, mirror)).toBe(4);
  expect(generation.add).toHaveBeenCalledOnce(); expect(generation.add.mock.calls[0][0]).toBe("generate");
  expect(mirror.add.mock.calls.map(call => call[0])).toEqual(["asset-mirror", "asset-mirror-delete", "inspiration-mirror"]);
});
it("persists cleanup before purging sources and never deletes a currently active asset", async () => {
  const config = { ...COS_DEFAULTS, bucket: "fixture-1250000000", secretId: "fixture-id", secretKey: "fixture-key" };
  const db = { outboxEvent: { upsert: vi.fn() }, asset: { findFirst: vi.fn(async () => null) } };
  await scheduleCosRemoval({ id: "fixture-asset" }, { config, db });
  expect(db.outboxEvent.upsert.mock.calls[0][0].create.kind).toBe("asset-mirror-delete");
  const target = { delete: vi.fn() };
  await processCosRemoval("fixture-asset", { config, db, target });
  expect(db.asset.findFirst).toHaveBeenCalledWith({ where: { id: "fixture-asset", status: { in: ["deleted", "purged"] } } });
  expect(target.delete).not.toHaveBeenCalled();
});
