import { afterEach, expect, it, vi } from "vitest";
import sharp from "sharp";
import { renderDelivery } from "../../src/lib/domain/generation/delivery.js";
import { PROFILES, batchState, digestJson } from "../../src/lib/domain/generation/contracts.js";
import { runQA } from "../../src/lib/qa-pipeline.js";

afterEach(() => vi.unstubAllEnvs());

it.each(Object.keys(PROFILES))("delivers exact %s pixels with padding and no stretching", async ratio => {
  const image = await sharp({ create: { width: 100, height: 100, channels: 3, background: "red" } }).png().toBuffer();
  const rendered = await renderDelivery(image, { ...PROFILES[ratio], fit: "contain" });
  const meta = await sharp(rendered).metadata();
  expect([meta.width, meta.height]).toEqual([PROFILES[ratio].width, PROFILES[ratio].height]);
  if (ratio !== "1:1") {
    const pixel = await sharp(rendered).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
    expect([...pixel].slice(0, 3)).toEqual([255, 255, 255]);
  }
});

it("reports absent, skipped and invalid QA as unknown instead of passed", async () => {
  const image = Buffer.from("fixture");
  expect((await runQA(null, image)).status).toBe("error");
  expect(await runQA(image, image, { skip: true })).toMatchObject({ status: "skipped", score: null });
  const client = { chat: { completions: { create: async () => ({ choices: [{ message: { content: '{"score":0.9,"pass":true,"flags":[]}' } }] }) } } };
  expect((await runQA(image, image, { client })).status).toBe("error");
  client.chat.completions.create = async () => ({ choices: [{ message: { content: '{"score":0.9,"flags":["COLOR_SHIFT"],"evidence":"Sleeves changed from red to blue"}' } }] });
  expect((await runQA(image, image, { client })).status).toBe("needs_review");
});

it("derives failed, partial and cancelled batches from actual outputs", () => {
  expect(batchState([{ status: "failed" }, { status: "failed" }]).status).toBe("failed");
  expect(batchState([{ status: "succeeded" }, { status: "cancelled" }]).status).toBe("partial_success");
  expect(batchState([{ status: "cancelled" }]).status).toBe("cancelled");
  expect(digestJson({ a: 1, b: 2 })).toBe(digestJson({ b: 2, a: 1 }));
});
