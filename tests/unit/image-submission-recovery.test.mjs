import { expect, it } from "vitest";
import { confirmedImageSubmission, submissionRejected } from "../../src/lib/studio/submission-recovery.js";
import { remapImageReferences } from "../../src/lib/studio/reference-numbering.js";

it("recovers only the original batch slot without altering the new draft", () => {
  const draft = { jobs: [], composer: { text: "next image" }, pendingSubmit: { key: "b" }, pendingBatch: { keys: ["a", "b", "c"], index: 1 } };
  const restored = confirmedImageSubmission(draft, { key: "b" }, { id: "job-b" });
  expect(restored.pendingBatch.index).toBe(2);
  expect(restored.jobs).toEqual(["job-b"]);
  expect(restored.composer).toBe(draft.composer);
  expect(confirmedImageSubmission(draft, { key: "a" }, { id: "other" })).toBe(draft);
});

it("retains the identity of requests with unknown outcomes", () => {
  for (const error of [{}, { status: 408 }, { status: 502 }, { status: 409, code: "IDEMPOTENCY_CONFLICT" }]) expect(submissionRejected(error)).toBe(false);
  expect(submissionRejected({ status: 409, code: "PRICE_CHANGED" })).toBe(true);
});

it("renumbers surviving references and marks deleted ones without rewriting dimensions", () => {
  expect(remapImageReferences("图1 与图2、@3、image 2，1920x1080", ["a", "b", "c"], ["c", "b"]))
    .toBe("[removed-reference] 与图2、@1、image 2，1920x1080");
});
