import { expect, it, vi } from "vitest";
import { digestJson } from "../../src/lib/domain/generation/contracts.js";
import { contentRunSchema } from "../../src/lib/creation/contracts/content-runs.js";
import { languageInputSchema } from "../../src/lib/creation/contracts/language.js";
import { createContentRun } from "../../src/lib/domain/creation/content-runs.js";
import { submitCreationLanguageStep } from "../../src/lib/domain/creation/language-jobs.js";

const body = { kind: "poster", prompt: "Coffee opening", width: 1080, height: 1440, maxCredits: 2 };
const legacy = input => { const result = { ...input }; delete result.referenceIds; return result; };
const previous = () => ({ id: "run", userId: "user", kind: "poster", digest: digestJson(legacy(contentRunSchema.parse(body))), input: {}, steps: [] });

it("replays a pre-attachment content request even with new creation disabled", async () => {
  const db = { creationRun: { findUnique: vi.fn(async () => previous()) } };
  for (const input of [body, { ...body, referenceIds: [] }]) {
    const run = await createContentRun("user", "session", input, "same-request-key-123", { db, env: {} });
    expect(run.id).toBe("run");
  }
});

it("does not treat a changed prompt or an added file as an old request replay", async () => {
  const db = { creationRun: { findUnique: async () => previous() } };
  for (const input of [{ ...body, prompt: "Different request" }, { ...body, referenceIds: ["brief"] }]) {
    await expect(createContentRun("user", "session", input, "same-request-key-123", { db, env: {} })).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  }
});

it("recovers a previously submitted language step without creating another paid job", async () => {
  const input = legacy(languageInputSchema.parse({ purpose: "poster.generate", prompt: "Coffee opening", width: 1080, height: 1440 }));
  const step = { id: "step", attempt: 0, params: input, jobId: "job" };
  const tx = { $queryRaw: async () => [], user: { findUnique: async () => ({ id: "user", status: "active" }) }, creationRun: { findFirst: async () => ({ id: "run", userId: "user", steps: [step] }) },
    tryOn: { findUnique: async () => ({ id: "job", status: "succeeded", creditCost: 2, snapshot: { digest: digestJson(input) } }), create: vi.fn() } };
  const db = { $transaction: async callback => callback(tx) };
  expect(await submitCreationLanguageStep("user", "run", "step", 1, { db, config: {} })).toEqual({ id: "job", status: "succeeded", cost: 2 });
  expect(tx.tryOn.create).not.toHaveBeenCalled();
});
