import { beforeAll, afterAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { domainFixture } from "../support/domain-fixture.mjs";
import { generationAuditDetail } from "../../src/lib/domain/identity/generation-audit.js";

let f;
beforeAll(async () => { f = await domainFixture(); });
afterAll(async () => { await f?.cleanup(); });

it("retrieves failed jobs with full prompts, all source assets, execution errors and read audit", async () => {
  const creator = await f.user(), admin = await f.user();
  const prompt = "高品质产品场景图，保留商品外观与文字".repeat(100);
  const job = await f.db.tryOn.create({ data: { userId: creator.id, requestId: randomUUID(), personImage: "", clothesImage: `/api/assets/${creator.asset.id}`, prompt,
    status: "failed", errorCode: "INVALID_IMAGE_SIZE", snapshot: { kind: "studio", tool: "edit", assetId: creator.asset.id, referenceAssetIds: [creator.asset.id], params: { prompt, size: "1024x1024" }, apiKey: "must-not-return" } } });
  await f.db.assetReference.create({ data: { assetId: creator.asset.id, kind: "generation_input", entityId: job.id } });
  await f.db.generationAttempt.create({ data: { tryOnId: job.id, fence: 1, provider: "fixture", state: "failed", errorCode: "INVALID_IMAGE_SIZE" } });
  const detail = await generationAuditDetail(job.id, admin.id, f.db);
  expect(detail).toMatchObject({ id: job.id, userId: creator.id, prompt, userPrompt: prompt, status: "failed", errorCode: "INVALID_IMAGE_SIZE", params: { prompt, size: "1024x1024" } });
  expect(detail.inputs).toHaveLength(1);
  expect(detail.inputs[0]).toMatchObject({ id: creator.asset.id, url: `/api/admin/assets/${creator.asset.id}`, unavailable: false, width: expect.any(Number) });
  expect(detail.snapshot.apiKey).toBeUndefined();
  expect(detail.attempts[0]).toMatchObject({ state: "failed", errorCode: "INVALID_IMAGE_SIZE" });
  expect(await f.db.adminAuditLog.count({ where: { adminId: admin.id, action: "READ_GENERATION", targetUserId: creator.id } })).toBe(1);
  await f.db.asset.update({ where: { id: creator.asset.id }, data: { status: "deleted" } });
  expect((await generationAuditDetail(job.id, admin.id, f.db)).inputs[0].unavailable).toBe(true);
  await expect(generationAuditDetail("missing-job", admin.id, f.db)).rejects.toThrow("JOB_NOT_FOUND");
});

it("exposes historic OCR results without result images and marks missing old language input", async () => {
  const creator = await f.user(), admin = await f.user();
  const row = await f.db.tryOn.create({ data: { userId: creator.id, requestId: randomUUID(), personImage: "", clothesImage: "", prompt: "OCR",
    snapshot: { kind: "studio", tool: "ocr", imageModel: "dedicated-ocr" }, resultData: { text: "识别出来的文字", ocr: { boxes: [{ text: "识别出来的文字", rect: { x: 0, y: 0, width: 1, height: 1 } }] } }, status: "succeeded" } });
  expect(await generationAuditDetail(row.id, admin.id, f.db)).toMatchObject({ tool: "ocr", resultData: { text: "识别出来的文字" }, outputs: [] });
  await f.db.tryOn.update({ where: { id: row.id }, data: { snapshot: { kind: "language", purpose: "studio-plan" } } });
  expect((await generationAuditDetail(row.id, admin.id, f.db)).inputNotRecorded).toBe(true);
});
