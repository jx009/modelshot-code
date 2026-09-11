import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import JSZip from "jszip";
import sharp from "sharp";
import { domainFixture } from "../support/domain-fixture.mjs";
import { FakeProvider } from "../support/fake-provider.mjs";
import { executeOutput } from "../../src/lib/domain/generation/execution.js";
import { processDelivery, processQuality } from "../../src/lib/domain/generation/delivery.js";
import { createExport, processExport, retryStep } from "../../src/lib/domain/generation/exports.js";
import { readOwnedImage } from "../../src/lib/domain/assets/service.js";

let f, user, id;
beforeAll(async () => {
  f = await domainFixture();
  user = await f.user(18);
  id = (await f.submit(user, { aspectRatio: "9:16", sku: "sku-123" })).tryonId;
  await executeOutput(id, { db: f.db, store: f.store, adapterFactory: async () => new FakeProvider() });
});
afterAll(async () => { await f?.cleanup(); });

it("recovers metadata failure independently and preserves the billed original", async () => {
  await expect(processDelivery(id, { db: f.db, store: f.store, annotate: async () => { throw new Error("Metadata unavailable"); } })).rejects.toThrow();
  const failed = await f.db.tryOn.findUnique({ where: { id } });
  expect(failed.status).toBe("succeeded");
  expect(failed.exportStatus).toBe("error");
  await retryStep(user.id, id, "delivery", f.db);
  await processDelivery(id, { db: f.db, store: f.store });
  const ready = await f.db.tryOn.findUnique({ where: { id } });
  const meta = await sharp(await readOwnedImage(user.id, ready.deliveryAssetId, f.db, f.store)).metadata();
  expect([meta.width, meta.height]).toEqual([1080, 1920]);
  expect(meta.exif).toBeDefined();
  expect(ready.metadataStatus).toBe("unsigned");
  expect(await f.db.creditTransaction.count({ where: { userId: user.id, type: "consume" } })).toBe(1);
});

it("preserves generation and billing when QA fails and permits independent retry", async () => {
  await expect(processQuality(id, { db: f.db, store: f.store, review: async () => ({ status: "error", score: null, flags: [], errorCode: "QA_SERVICE_ERROR" }) })).rejects.toThrow();
  expect((await f.db.tryOn.findUnique({ where: { id } })).qaStatus).toBe("error");
  await retryStep(user.id, id, "qa", f.db);
  await processQuality(id, { db: f.db, store: f.store, review: async () => ({ status: "needs_review", score: 0.4, flags: ["COLOR_SHIFT"], evidence: "Changed fabric color" }) });
  const output = await f.db.tryOn.findUnique({ where: { id } });
  expect([output.status, output.qaStatus]).toEqual(["succeeded", "needs_review"]);
  expect(await f.db.creditTransaction.count({ where: { userId: user.id, type: "refund" } })).toBe(0);
});

it("exports a fixed owned selection with exact pixels, descriptive filenames and manifests", async () => {
  const key = randomUUID();
  const job = await createExport(user.id, [id], "delivery", key, f.db);
  expect((await createExport(user.id, [id], "delivery", key, f.db)).id).toBe(job.id);
  await expect(createExport("someone-else", [id], "delivery", randomUUID(), f.db)).rejects.toThrow("OUTPUT_NOT_FOUND");
  await processExport(job.id, { db: f.db, store: f.store });
  const done = await f.db.exportJob.findUnique({ where: { id: job.id } });
  expect(done.status).toBe("succeeded");
  const zip = await JSZip.loadAsync(await f.store.get(done.objectKey));
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  expect(manifest.images[0].filename).toMatch(/^sku-123_.*\.png$/);
  expect(zip.file("manifest.csv")).not.toBeNull();
  const meta = await sharp(await zip.file(manifest.images[0].filename).async("nodebuffer")).metadata();
  expect([meta.width, meta.height]).toEqual([1080, 1920]);
});

it("cancels queued exports without touching generation charges", async () => {
  const job = await createExport(user.id, [id], "original", randomUUID(), f.db);
  await f.db.exportJob.update({ where: { id: job.id }, data: { cancelRequestedAt: new Date() } });
  await processExport(job.id, { db: f.db, store: f.store });
  expect((await f.db.exportJob.findUnique({ where: { id: job.id } })).status).toBe("cancelled");
  expect(await f.db.creditTransaction.count({ where: { userId: user.id, type: "consume" } })).toBe(1);
});
