import { expect, it } from "vitest";
import { imageRunSchema, nextImageSource } from "../../src/lib/creation/contracts/runs.js";

const plan = steps => ({ kind: "image", documentId: "canvas", documentVersion: 1, maxCredits: 50, summary: "A plan", steps });
const step = tool => ({ tool, params: { prompt: "A blue ball" }, explanation: tool });
it("rejects non-image outputs in the middle of an image chain", () => {
  expect(imageRunSchema.safeParse(plan([step("generate"), step("video"), step("edit")])).success).toBe(false);
  expect(imageRunSchema.safeParse(plan([step("generate"), step("edit"), step("video")])).success).toBe(true);
});
it("requires a real initial source and excludes interactive or arbitrary tools", () => {
  expect(imageRunSchema.safeParse(plan([step("edit")])).success).toBe(false);
  expect(imageRunSchema.safeParse(plan([step("generate"), step("inpaint")])).success).toBe(false);
  expect(imageRunSchema.safeParse(plan([step("shell")])).success).toBe(false);
});
it("takes successor input only from the persisted predecessor output", () => {
  const run = { input: { source: { assetId: "old", targetId: "layer" } } };
  expect(nextImageSource(run, null, null)).toEqual(run.input.source);
  expect(nextImageSource(run, { id: "step" }, { id: "job", resultData: { assets: [{ id: "new", contentType: "image/png" }] } })).toEqual({ assetId: "new", targetId: "job-0" });
  expect(nextImageSource(run, { id: "step" }, { resultData: { assets: [{ id: "video", contentType: "video/mp4" }] } })).toBeNull();
});
