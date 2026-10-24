import { expect, it, vi } from "vitest";
import { createContentRun, resumeContentRun } from "../../src/lib/domain/creation/content-runs.js";
import { submitCreationLanguageStep } from "../../src/lib/domain/creation/language-jobs.js";
import { officeReferencesAvailable } from "../../src/lib/domain/creation/reference-admission.js";
import { creationInputDigest } from "../../src/lib/domain/creation/input-digest.js";
import { languageInputSchema } from "../../src/lib/creation/contracts/language.js";
import { REFERENCE_READER_VERSION } from "../../src/lib/creation/reference-policy.js";

vi.mock("../../src/lib/prisma.js", () => ({ prisma: {} }));
vi.mock("../../src/lib/domain/creation/events.js", () => ({ appendRunEvent: async db => db.run, enqueueRun: vi.fn() }));
const config = { visionApiKey: "fixture", chatModel: "fixture", plannerCreditCost: 1 };
const env = { CREATION_RUNS_ENABLED: "true", CREATION_WORKSPACE_ENABLED: "true", CREATION_POSTER_ENABLED: "true", CREATION_OFFICE_REFERENCES_ENABLED: "true" };
function fixture() {
  const input = languageInputSchema.parse({ purpose: "poster.generate", prompt: "Use the brief", width: 1080, height: 1440, referenceIds: ["brief"] });
  const step = { id: "step", position: 0, attempt: 0, status: "ready", tool: input.purpose, params: input, expectedCost: 1 };
  const run = { id: "run", userId: "u", sessionId: "session", projectId: "project", kind: "poster", status: "queued", eventSequence: 1, committedCredits: 0, maxCredits: 2, input: { languageUnitCost: 1, referenceIds: ["brief"] }, steps: [step] };
  const db = { run, $queryRaw: async () => [], user: { findUnique: async () => ({ id: "u", status: "active" }) },
    creationRun: { findFirst: async () => run, findUnique: vi.fn(async () => null), count: async () => 0, create: vi.fn() },
    creationSession: { findFirst: async () => ({ id: "session", projectId: "project", project: { kind: "poster" } }) },
    creationProject: { findFirst: async () => ({ id: "project" }) },
    creationReference: { findMany: vi.fn(async () => [{ id: "brief", fileType: "docx", bytes: 500000 }]) },
    serviceHeartbeat: { findUnique: vi.fn(async ({ where }) => where.id === "creation-reference-reader" ? null : { updatedAt: new Date() }) },
    creationStep: { update: vi.fn() },
    tryOn: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []), create: vi.fn() },
  };
  db.$transaction = async fn => fn(db);
  return { db, run, step, config, env, ensureWorkers: vi.fn(), configFor: async () => config };
}
it("rejects a new Office-backed request before creating a run when the parser heartbeat is missing", async () => {
  const f = fixture();
  await expect(createContentRun("u", "session", { kind: "poster", prompt: "Use brief", referenceIds: ["brief"], width: 1080, height: 1440, maxCredits: 2 }, "reference-submit-key", f)).rejects.toThrow("CREATION_REFERENCE_READER_UNAVAILABLE");
  expect(f.db.creationRun.create).not.toHaveBeenCalled();
});
it("rechecks Office availability for every new paid step before job creation", async () => {
  const f = fixture();
  await expect(submitCreationLanguageStep("u", "run", "step", 1, f)).rejects.toThrow("CREATION_REFERENCE_READER_UNAVAILABLE");
  expect(f.db.tryOn.create).not.toHaveBeenCalled();
  f.db.creationReference.findMany.mockResolvedValue([]);
  await expect(submitCreationLanguageStep("u", "run", "step", 1, f)).rejects.toThrow("CREATION_REFERENCE_NOT_FOUND");
});
it("replays a previously submitted Office step without reading files or admitting another call", async () => {
  const f = fixture(); f.step.jobId = "job";
  f.db.tryOn.findUnique.mockResolvedValue({ id: "job", status: "succeeded", creditCost: 1, snapshot: { digest: creationInputDigest(f.step.params) } });
  expect(await submitCreationLanguageStep("u", "run", "step", 1, { ...f, env: {} })).toEqual({ id: "job", status: "succeeded", cost: 1 });
  expect(f.db.creationReference.findMany).not.toHaveBeenCalled();
});
it("blocks a paid retry but allows publication recovery with Office admission off", async () => {
  const f = fixture(); f.step.jobId = "job"; f.step.status = "failed";
  f.db.tryOn.findMany.mockResolvedValue([{ id: "job", status: "failed" }]);
  await expect(resumeContentRun("u", f.run, { expectedSequence: 1, maxCredits: 2 }, f)).rejects.toThrow("CREATION_REFERENCE_READER_UNAVAILABLE");
  expect(f.db.creationStep.update).not.toHaveBeenCalled();
  f.db.tryOn.findMany.mockResolvedValue([{ id: "job", status: "succeeded" }]);
  f.db.creationRun.findUnique.mockResolvedValue(f.run);
  f.db.creationReference.findMany.mockClear();
  await resumeContentRun("u", f.run, { expectedSequence: 1, maxCredits: 2 }, { ...f, env: {} });
  expect(f.db.creationReference.findMany).not.toHaveBeenCalled();
  expect(f.db.creationStep.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "running" }) }));
});
it("requires the enabled flag and fresh matching isolated heartbeat", async () => {
  const f = fixture(), now = Date.now();
  for (const [age, version, isolated, available] of [[0, REFERENCE_READER_VERSION, true, true], [90000, REFERENCE_READER_VERSION, true, false], [-20000, REFERENCE_READER_VERSION, true, false], [0, "old", true, false], [0, REFERENCE_READER_VERSION, false, false]]) {
    f.db.serviceHeartbeat.findUnique.mockResolvedValue({ updatedAt: new Date(now - age), details: { version, isolated } });
    expect(await officeReferencesAvailable(f.db, now, env)).toBe(available);
  }
  expect(await officeReferencesAvailable(f.db, now, {})).toBe(false);
});
