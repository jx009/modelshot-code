import { expect, it, vi } from "vitest";
import { AppError } from "../../src/lib/http.js";
import { advanceRun } from "../../src/lib/domain/creation/scheduler.js";
import { resumeContentRun } from "../../src/lib/domain/creation/content-runs.js";
import { submitCreationLanguageStep } from "../../src/lib/domain/creation/language-jobs.js";
import { HTML_PIPELINE_VERSION } from "../../src/lib/creation/contracts/html-runtime.js";
import { languageInputSchema } from "../../src/lib/creation/contracts/language.js";

vi.mock("../../src/lib/prisma.js", () => ({ prisma: {} }));
vi.mock("../../src/lib/infra/storage/s3.js", () => ({ objectStorage: () => { throw new Error("Real storage forbidden"); } }));

const theme = { name: "Deck", primary: "#123456", accent: "#ff6600", background: "#ffffff", fontFamily: "sans" };
const config = { visionApiKey: "fixture", chatModel: "fixture", plannerCreditCost: 0 };
function fixture(statuses = ["running", "ready", "ready"]) {
  const pages = statuses.map((status, index) => ({ id: `page${index}`, position: index + 1, tool: "slides.page", attempt: 0, expectedCost: 0, status,
    dependsOn: ["outline"], jobId: status === "ready" ? null : `job${index}`,
    params: languageInputSchema.parse({ purpose: "slides.page", sourceFormat: "html", prompt: "Launch", pageId: `page${index}`, title: "Page", brief: "Supplied facts", theme, width: 1280, height: 720 }),
  }));
  const run = { id: "run", userId: "u", projectId: "project", sessionId: "session", kind: "slides", status: "running", eventSequence: 1, committedCredits: 10, maxCredits: 100, input: { languageUnitCost: 0 },
    steps: [{ id: "outline", position: 0, tool: "slides.outline", status: "succeeded", dependsOn: [], params: {} }, ...pages,
      { id: "assemble", position: pages.length + 1, tool: "layout.assemble", status: "blocked", dependsOn: pages.map(page => page.id), expectedCost: 0 }],
  };
  const jobs = new Map(pages.filter(page => page.jobId).map(page => [page.jobId, { id: page.jobId, userId: "u", status: page.status, creditCost: 2 }]));
  const apply = (row, data) => {
    for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === "object" && ("increment" in value || "decrement" in value) ? row[key] + (value.increment || 0) - (value.decrement || 0) : structuredClone(value);
    return structuredClone(row);
  };
  const db = { $queryRaw: vi.fn(), user: { findUnique: async () => ({ id: "u", status: "active" }) },
    creationProject: { findFirst: async () => ({ id: "project" }) },
    serviceHeartbeat: { findUnique: async () => ({ updatedAt: new Date(), details: { version: HTML_PIPELINE_VERSION } }) },
    creationRun: { findFirst: async () => structuredClone(run), findUnique: async () => structuredClone(run), count: async () => 0, update: async ({ data }) => apply(run, data) },
    creationStep: { update: vi.fn(async ({ where, data }) => apply(run.steps.find(step => step.id === where.id), data)),
      updateMany: async ({ where, data }) => { for (const step of run.steps) if (!step.jobId && where.status.in.includes(step.status)) apply(step, data); } },
    creationStepAttempt: { create: vi.fn() }, creationEvent: { create: vi.fn() }, outboxEvent: { create: vi.fn(), upsert: vi.fn() },
    tryOn: { findFirst: async ({ where }) => structuredClone(jobs.get(where.id) || null),
      findMany: async ({ where }) => [...jobs.values()].filter(job => where.id.in.includes(job.id)).map(job => structuredClone(job)),
      findUnique: async ({ where }) => structuredClone([...jobs.values()].find(job => job.requestId === where.requestId) || null),
      count: async ({ where }) => [...jobs.values()].filter(job => where.status.in.includes(job.status)).length,
      create: vi.fn(async ({ data }) => { const job = { ...data, status: "queued" }; jobs.set(job.id, job); return job; }),
    },
  };
  // The real transaction acquires the user row lock before checking capacity.
  let tail = Promise.resolve();
  db.$transaction = callback => { const result = tail.then(() => callback(db)); tail = result.catch(() => {}); return result; };
  return { run, jobs, db, config, languageConfigFor: async () => config, store: {}, env: { CREATION_WORKSPACE_ENABLED: "true", CREATION_RUNS_ENABLED: "true", CREATION_SLIDES_ENABLED: "true" }, ensureWorkers: vi.fn(), configFor: async () => config };
}

it("admits a second page, immediately dispatches more work and rejects a third under the user lock", async () => {
  const f = fixture();
  await submitCreationLanguageStep("u", "run", "page1", 1, f);
  expect(f.db.tryOn.create).toHaveBeenCalledOnce();
  expect(f.run.steps[2].status).toBe("queued");
  expect(f.db.outboxEvent.upsert.mock.calls[0][0].create.businessKey).toContain("dispatch:");
  await expect(submitCreationLanguageStep("u", "run", "page2", f.run.eventSequence, f)).rejects.toThrow("USER_QUEUE_FULL");
  expect(f.db.tryOn.create).toHaveBeenCalledOnce();
  await submitCreationLanguageStep("u", "run", "page1", 1, f);
  expect(f.db.tryOn.create).toHaveBeenCalledOnce();
});

it("serializes racing wakes before creating any duplicate or third billable job", async () => {
  const f = fixture();
  const outcomes = await Promise.allSettled(["page1", "page2"].map(id => submitCreationLanguageStep("u", "run", id, 1, f)));
  expect(outcomes.map(result => result.status)).toEqual(["fulfilled", "rejected"]);
  expect(f.db.tryOn.create).toHaveBeenCalledOnce();
  expect(f.db.creationStepAttempt.create).toHaveBeenCalledOnce();
});

it("dispatches another page without waiting and publishes a later completion first", async () => {
  const f = fixture(), submitLanguage = vi.fn(), publishLanguage = vi.fn();
  await advanceRun("run", { ...f, submitLanguage, publishLanguage });
  expect(submitLanguage.mock.calls[0][2]).toBe("page1");
  f.run.steps[2].jobId = "job1"; f.run.steps[2].status = "running";
  f.jobs.set("job1", { id: "job1", status: "succeeded" });
  await advanceRun("run", { ...f, submitLanguage, publishLanguage });
  expect(publishLanguage.mock.calls[0][1].id).toBe("page1");
});

it("settles a failed job once, continues independent pages and never assembles an incomplete deck", async () => {
  const f = fixture(["running", "running"]), assembleSlides = vi.fn();
  f.jobs.get("job0").status = "failed"; f.jobs.get("job0").errorCode = "LANGUAGE_TIMEOUT";
  await advanceRun("run", { ...f, assembleSlides });
  expect(f.run.committedCredits).toBe(8); expect(f.run.status).toBe("running");
  await advanceRun("run", { ...f, assembleSlides });
  expect(f.run.committedCredits).toBe(8);
  f.jobs.get("job1").status = "failed"; f.jobs.get("job1").errorCode = "LANGUAGE_RESULT_INVALID";
  await advanceRun("run", { ...f, assembleSlides });
  expect(f.run.status).toBe("failed"); expect(f.run.committedCredits).toBe(6);
  await advanceRun("run", { ...f, assembleSlides });
  expect(f.run.committedCredits).toBe(6); expect(assembleSlides).not.toHaveBeenCalled();
});

it("keeps a successful paid checkpoint after publication failure and drains other pages", async () => {
  const f = fixture(["running", "running"]); f.jobs.get("job0").status = "succeeded";
  const publishLanguage = vi.fn(async () => { throw new AppError("ARTIFACT_VERSION_CONFLICT", 409); });
  await advanceRun("run", { ...f, publishLanguage });
  expect(f.run.steps[1]).toMatchObject({ status: "failed", jobId: "job0" });
  expect(f.run.committedCredits).toBe(10); expect(f.run.status).toBe("running");
  await advanceRun("run", { ...f, publishLanguage });
  expect(publishLanguage).toHaveBeenCalledOnce();
});

it("does not pause a deck or change accounting on a publication CAS race", async () => {
  const f = fixture(["running"]); f.jobs.get("job0").status = "succeeded";
  await advanceRun("run", { ...f, publishLanguage: async () => { f.run.eventSequence++; throw new AppError("CREATION_RUN_CHANGED", 409); } });
  expect(f.run.status).toBe("running"); expect(f.run.steps[1].status).toBe("running"); expect(f.run.committedCredits).toBe(10);
});

it("cancels all active jobs and settles each before ending the deck without double refund", async () => {
  const f = fixture(["running", "running", "ready"]); f.run.cancelRequestedAt = new Date();
  const cancel = vi.fn(async (_user, id) => { f.jobs.get(id).status = "cancelled"; });
  await advanceRun("run", { ...f, cancel });
  expect(cancel.mock.calls.map(call => call[1])).toEqual(["job0", "job1"]);
  expect(f.run.status).toBe("cancelling"); expect(f.run.committedCredits).toBe(8);
  await advanceRun("run", { ...f, cancel });
  expect(f.run.status).toBe("cancelled"); expect(f.run.committedCredits).toBe(6);
  await advanceRun("run", { ...f, cancel });
  expect(f.run.committedCredits).toBe(6); expect(f.db.tryOn.create).not.toHaveBeenCalled();
});

it("upgrades resumed serial plans, keeps successful calls and retries only failed calls", async () => {
  const f = fixture(["failed", "failed", "ready"]); f.run.status = "failed";
  f.jobs.get("job0").status = "succeeded";
  f.run.steps[2].dependsOn = ["page0"]; f.run.steps[3].dependsOn = ["page1"];
  await resumeContentRun("u", structuredClone(f.run), { expectedSequence: 1, maxCredits: 100, retryFailed: true }, f);
  expect(f.run.steps[1]).toMatchObject({ status: "running", jobId: "job0", attempt: 0 });
  expect(f.run.steps[2]).toMatchObject({ status: "ready", jobId: null, attempt: 1, dependsOn: ["outline"] });
  expect(f.run.steps[3]).toMatchObject({ status: "ready", jobId: null, attempt: 0, dependsOn: ["outline"] });
  expect(f.db.tryOn.create).not.toHaveBeenCalled();
});
