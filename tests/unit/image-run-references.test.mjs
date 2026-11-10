import { expect, it } from "vitest";
import { imageRunSchema, imageRunStepInputs, nextImageSource } from "../../src/lib/creation/contracts/runs.js";

const plan = { kind: "image", documentId: "canvas", documentVersion: 1, source: { targetId: "subject-layer", assetId: "subject" }, referenceAssetIds: ["style", "scene"], referenceRoles: ["subject", "style", "scene"], summary: "A campaign", maxCredits: 100, steps: [{ tool: "edit", params: { prompt: "Compose subject with style and scene" }, explanation: "Compose" }] };

it("carries extra references and roles through each durable image step", () => {
  const parsed = imageRunSchema.parse(plan), run = { input: parsed };
  const next = nextImageSource(run, { id: "step-1" }, { id: "job-1", resultData: { assets: [{ id: "new-subject", contentType: "image/png" }] } });
  expect(next).toEqual({ assetId: "new-subject", targetId: "job-1-0" });
  expect(imageRunStepInputs(run, parsed.steps[0])).toMatchObject({ referenceAssetIds: ["style", "scene"], params: { referenceRoles: ["subject", "style", "scene"] } });
  expect(imageRunStepInputs(run, { tool: "ocr", params: {} })).toEqual({ params: {} });
});
it("rejects duplicate assets, orphan references and misaligned role arrays", () => {
  expect(imageRunSchema.safeParse({ ...plan, referenceAssetIds: ["subject"] }).success).toBe(false);
  expect(imageRunSchema.safeParse({ ...plan, source: undefined }).success).toBe(false);
  expect(imageRunSchema.safeParse({ ...plan, referenceRoles: ["style"] }).success).toBe(false);
});
