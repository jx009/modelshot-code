import { expect, it, vi } from "vitest";
import { createImageRun, resumeRun } from "../../src/lib/domain/creation/runs.js";
import { createStoryboardRun } from "../../src/lib/domain/creation/storyboard-runs.js";
import { createContentRun } from "../../src/lib/domain/creation/content-runs.js";
import { emptyComposition } from "../../src/lib/video/timeline.js";

vi.mock("../../src/lib/prisma.js", () => ({ prisma: {} }));
vi.mock("../../src/lib/domain/creation/messages.js", () => ({ appendCreationMessage: vi.fn() }));
vi.mock("../../src/lib/domain/studio/providers.js", () => ({
  studioConfig: vi.fn(async () => ({ imageProvider: "image-provider" })),
  capabilities: vi.fn(async () => ({ tools: [{ id: "motion-render", available: true, cost: 0 }] })),
}));

const env = { CREATION_WORKSPACE_ENABLED: "true", CREATION_RUNS_ENABLED: "true", CREATION_MOTION_ENABLED: "true", CREATION_SLIDES_ENABLED: "true" };
const occupiedStates = ["queued", "running", "cancelling", "awaiting_input", "awaiting_budget"];

function fixture(existing = []) {
  const rows = [...existing];
  const composition = emptyComposition("scene-one");
  composition.scenes[0].source = "text";
  const document = { id: "document", userId: "owner", kind: "motion", version: 1, content: { layers: [], video: { mode: "motion", media: [], composition } } };
  const matches = (row, where) => (!where.userId || row.userId === where.userId)
    && (!where.documentId || row.documentId === where.documentId)
    && (!where.sessionId || row.sessionId === where.sessionId)
    && (!where.status || where.status.in.includes(row.status))
    && (!where.id?.not || row.id !== where.id.not);
  const db = {
    $queryRaw: vi.fn(),
    user: { findUnique: vi.fn(async () => ({ id: "owner", status: "active" })) },
    studioDocument: { findFirst: vi.fn(async () => document) },
    creationSession: { findFirst: vi.fn(async () => ({ id: "session", projectId: "project", project: { kind: "slides" } })) },
    serviceHeartbeat: { findMany: vi.fn(async () => [{ id: "worker" }, { id: "creation-worker" }]) },
    creationRun: {
      count: vi.fn(async ({ where }) => rows.filter(row => matches(row, where)).length),
      findUnique: vi.fn(async ({ where }) => rows.find(row => row.requestId === where.requestId) || null),
      findFirst: vi.fn(async ({ where }) => rows.find(row => row.id === where.id && row.userId === where.userId) || null),
      create: vi.fn(async ({ data }) => {
        const row = { ...data, id: `run-${rows.length}`, eventSequence: 0, committedCredits: 0, status: "queued", steps: data.steps.create };
        rows.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }) => {
        const row = rows.find(item => item.id === where.id);
        const sequence = row.eventSequence + (data.eventSequence?.increment || 0);
        Object.assign(row, data, { eventSequence: sequence });
        return row;
      }),
    },
    creationStep: { update: vi.fn() },
    creationEvent: { create: vi.fn() },
    outboxEvent: { create: vi.fn(), upsert: vi.fn() },
  };
  db.$transaction = async action => action(db);
  const deps = { env, ensureWorkers: vi.fn(), configFor: async () => ({ visionApiKey: "fixture", chatModel: "fixture", plannerCreditCost: 0 }),
    priceSteps: vi.fn(async () => ({ costs: [0], providers: [], provider: "image-provider" })) };
  return { db, deps, rows };
}

function submit(kind, db, deps, key = "admission-request-key") {
  if (kind === "slides") return createContentRun("owner", "session", { kind, prompt: "Independent deck", width: 1280, height: 720, maxCredits: 0 }, key, { ...deps, db });
  if (kind === "storyboard") return createStoryboardRun("owner", {
    documentId: "document", documentVersion: 1, sceneIds: ["scene-one"], maxCredits: 0, expectedTotal: 0,
  }, key, db, env);
  return createImageRun("owner", {
    kind: "image", documentId: "document", documentVersion: 1, summary: "New image", maxCredits: 0,
    steps: [{ tool: "generate", explanation: "Generate", params: { prompt: "A landscape", size: "1024x1024" } }],
  }, key, db, deps);
}

it.each(["storyboard", "image"])("admits a %s plan while other documents and sessions are occupied", async kind => {
  const existing = occupiedStates.map((status, index) => ({ id: `other-${index}`, userId: "owner", documentId: `other-document-${index}`, status }));
  existing.push({ id: "paused-session", userId: "owner", sessionId: "old-session", status: "awaiting_input" });
  const { db, deps } = fixture(existing);
  await expect(submit(kind, db, deps)).resolves.toMatchObject({ kind, status: "queued" });
  expect(db.creationRun.count).toHaveBeenCalledWith({ where: { userId: "owner", documentId: "document", status: { in: expect.arrayContaining(occupiedStates) } } });
  expect(db.outboxEvent.upsert).toHaveBeenCalledOnce();
});

it.each(["storyboard", "image"].flatMap(kind => occupiedStates.map(status => [kind, status])))("rejects a second %s plan on the same document while %s", async (kind, status) => {
  const { db, deps } = fixture([{ id: "existing", userId: "owner", documentId: "document", status }]);
  await expect(submit(kind, db, deps)).rejects.toMatchObject({ code: "CREATION_SCOPE_BUSY", status: 409 });
  expect(db.creationRun.create).not.toHaveBeenCalled();
  expect(db.outboxEvent.upsert).not.toHaveBeenCalled();
});

it.each(["storyboard", "image"])("keeps %s idempotency and rejects a new key on the occupied document", async kind => {
  const { db, deps } = fixture();
  const first = await submit(kind, db, deps);
  db.creationRun.count.mockClear();
  expect((await submit(kind, db, deps)).id).toBe(first.id);
  expect(db.creationRun.count).not.toHaveBeenCalled();
  expect(db.creationRun.create).toHaveBeenCalledOnce();
  await expect(submit(kind, db, deps, "another-request-key")).rejects.toThrow("CREATION_SCOPE_BUSY");
});

it.each(["storyboard", "image"])("allows a new %s plan after previous plans have ended", async kind => {
  const existing = ["succeeded", "failed", "cancelled"].map(status => ({ id: status, userId: "owner", documentId: "document", status }));
  const { db, deps } = fixture(existing);
  await expect(submit(kind, db, deps)).resolves.toMatchObject({ status: "queued" });
});

it.each(["storyboard", "image", "slides"])("retains the global queue limit for %s plans", async kind => {
  const { db, deps } = fixture();
  db.creationRun.count.mockImplementation(async ({ where }) => where.userId ? 0 : 1000);
  await expect(submit(kind, db, deps)).rejects.toThrow("CREATION_QUEUE_FULL");
  expect(db.creationRun.create).not.toHaveBeenCalled();
});

it("admits content plans without blocking on another session or document", async () => {
  const { db, deps } = fixture([
    { id: "old-session", userId: "owner", sessionId: "other-session", status: "awaiting_input" },
    { id: "old-document", userId: "owner", documentId: "other-document", status: "running" },
  ]);
  await expect(submit("slides", db, deps)).resolves.toMatchObject({ kind: "slides", sessionId: "session", status: "queued" });
  expect(db.creationRun.count).toHaveBeenCalledWith({ where: { userId: "owner", sessionId: "session", status: { in: expect.arrayContaining(occupiedStates) } } });
});

it.each(occupiedStates)("rejects a content plan in the same session while %s", async status => {
  const { db, deps } = fixture([{ id: "existing", userId: "owner", sessionId: "session", status }]);
  await expect(submit("slides", db, deps)).rejects.toThrow("CREATION_SCOPE_BUSY");
  expect(db.creationRun.create).not.toHaveBeenCalled();
});

it.each(["storyboard", "image", "video"])("resumes a %s plan without counting itself or other documents", async kind => {
  const run = { id: "paused", userId: "owner", documentId: "document", kind, status: "awaiting_input", eventSequence: 1,
    input: {}, committedCredits: 0, steps: [{ id: "step", status: "blocked", params: {} }] };
  const { db, deps } = fixture([run, { id: "other", userId: "owner", documentId: "other-document", status: "running" }]);
  const options = { ...deps, env: { ...env, CREATION_VIDEO_ENABLED: "true" } };
  await expect(resumeRun("owner", run.id, { expectedSequence: 1, maxCredits: 0 }, db, options)).resolves.toMatchObject({ status: "queued" });
  expect(db.creationRun.count).toHaveBeenCalledWith({ where: { userId: "owner", documentId: "document", id: { not: run.id }, status: { in: expect.arrayContaining(occupiedStates) } } });
});

it("refuses to resume a failed plan while its document has a replacement plan", async () => {
  const run = { id: "failed", userId: "owner", documentId: "document", kind: "storyboard", status: "failed", eventSequence: 1,
    input: {}, committedCredits: 0, steps: [{ id: "step", status: "failed", params: {} }] };
  const { db, deps } = fixture([run, { id: "replacement", userId: "owner", documentId: "document", status: "running" }]);
  await expect(resumeRun("owner", run.id, { expectedSequence: 1, maxCredits: 0, retryFailed: true }, db, deps)).rejects.toThrow("CREATION_SCOPE_BUSY");
  expect(db.creationStep.update).not.toHaveBeenCalled();
});
