import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { domainFixture } from "../support/domain-fixture.mjs";
import { AppError } from "../../src/lib/http.js";
import { createProject, readMessages } from "../../src/lib/domain/creation/projects.js";
import { createContentRun } from "../../src/lib/domain/creation/content-runs.js";
import { readRun, resumeRun, cancelRun } from "../../src/lib/domain/creation/runs.js";
import { advanceRun, recoverRuns } from "../../src/lib/domain/creation/scheduler.js";
import { executeCreationLanguage } from "../../src/lib/domain/creation/language-execution.js";
import { createLayoutArtifact, readLayoutArtifact, modifyLayoutArtifact } from "../../src/lib/domain/creation/artifacts.js";
import { usageSummary } from "../../src/lib/domain/billing/ledger.js";
import { confirmOutline, readOutlineReview } from "../../src/lib/domain/creation/outline-review.js";
import { readDocumentArtifact } from "../../src/lib/domain/creation/document-artifacts.js";
import { DOCUMENT_SCHEDULER_HEARTBEAT, DOCUMENT_LANGUAGE_HEARTBEAT, DOCUMENT_PIPELINE_VERSION } from "../../src/lib/creation/contracts/document-runtime.js";
import { HTML_SCHEDULER_HEARTBEAT, HTML_LANGUAGE_HEARTBEAT, HTML_PIPELINE_VERSION } from "../../src/lib/creation/contracts/html-runtime.js";

let fixture;
const users = [], objects = new Map();
const store = { put: async (key, bytes) => objects.set(key, Buffer.from(bytes)), get: async key => {
  if (!objects.has(key)) throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
  return Buffer.from(objects.get(key));
} };
const config = { plannerProvider: "fixture-language", plannerKind: "openai", visionBaseURL: "https://fixture.invalid/v1", visionApiKey: "fixture", chatModel: "fixture-model", plannerCreditCost: 2 };
const env = { CREATION_RUNS_ENABLED: "true", CREATION_WORKSPACE_ENABLED: "true", CREATION_POSTER_ENABLED: "true", CREATION_SLIDES_ENABLED: "true", CREATION_DOCUMENT_ENABLED: "true" };
const configFor = async () => config;
const theme = { name: "Coffee", primary: "#202124", accent: "#ff8800", background: "#ffffff", fontFamily: "sans" };
const page = (id = "page", title = "Opening") => ({ id, title, width: 1080, height: 1440, nodes: [
  { id: "date", type: "text", name: "Date", text: "10 月 24 日", x: 80, y: 120, width: 900, height: 80, style: { fontSize: 48 } },
] });
const poster = () => ({ schemaVersion: 1, kind: "poster", title: "Coffee opening", theme, pages: [page()] });
const options = () => ({ db: fixture.db, store, env, configFor });
const advance = (id, extra = {}) => advanceRun(id, { db: fixture.db, store, languageConfigFor: configFor, ...extra });
const execute = (id, invoke) => executeCreationLanguage(id, { db: fixture.db, store, configFor, invoke });
async function setup(kind = "poster") {
  const user = await fixture.user(); users.push(user.id);
  const project = await createProject(user.id, { createKey: randomUUID(), name: "Coffee", kind }, fixture.db);
  for (const id of ["worker", "creation-worker", "creation-language-worker"]) await fixture.db.serviceHeartbeat.upsert({ where: { id }, create: { id }, update: { updatedAt: new Date() } });
  if (kind === "document") for (const id of [DOCUMENT_SCHEDULER_HEARTBEAT, DOCUMENT_LANGUAGE_HEARTBEAT]) await fixture.db.serviceHeartbeat.upsert({ where: { id }, create: { id, details: { version: DOCUMENT_PIPELINE_VERSION } }, update: { updatedAt: new Date(), details: { version: DOCUMENT_PIPELINE_VERSION } } });
  const sessionId = project.sessions[0].id;
  const input = kind === "document" ? { kind, prompt: "咖啡店开业方案", locale: "zh", sectionCount: 2, audience: "店长", maxCredits: 6 } : { kind, prompt: "Coffee opening", locale: "zh", width: 1080, height: 1440, pageCount: kind === "slides" ? 2 : 1, maxCredits: kind === "slides" ? 6 : 2 };
  return { user, project, sessionId, input, create: (body = input, key = randomUUID()) => createContentRun(user.id, sessionId, body, key, options()) };
}
beforeAll(async () => { fixture = await domainFixture(); });
afterAll(async () => {
  if (!fixture) return;
  const runs = await fixture.db.creationRun.findMany({ where: { userId: { in: users } }, select: { id: true } });
  await fixture.db.outboxEvent.deleteMany({ where: { entityId: { in: runs.map(run => run.id) } } });
  await fixture.db.creationRun.deleteMany({ where: { userId: { in: users } } });
  await fixture.db.creationProject.deleteMany({ where: { userId: { in: users } } });
  await fixture.db.tryOn.updateMany({ where: { userId: { in: users } }, data: { creationResultBlobId: null } });
  await fixture.db.creationBlob.deleteMany({ where: { userId: { in: users } } });
  await fixture.cleanup();
});

it("recovers an unpublished successful poster without regenerating or rescheduling the completed run", async () => {
  const { user, sessionId, create, input } = await setup(), key = randomUUID();
  for (const id of [HTML_SCHEDULER_HEARTBEAT, HTML_LANGUAGE_HEARTBEAT]) await fixture.db.serviceHeartbeat.upsert({ where: { id },
    create: { id, details: { version: HTML_PIPELINE_VERSION } }, update: { updatedAt: new Date(), details: { version: HTML_PIPELINE_VERSION } } });
  const run = await create(input, key);
  expect((await create(input, key)).id).toBe(run.id);
  await advance(run.id);
  const started = await readRun(user.id, run.id, fixture.db), invoke = vi.fn(async () => ({
    schemaVersion: 3, format: "html-poster", kind: "poster", title: "Coffee opening", theme,
    pages: [{ id: "page", title: "Opening", width: 1080, height: 1440,
      html: '<!DOCTYPE html><html><head></head><body><p data-node-id="date">10 月 24 日</p></body></html>' }],
  }));
  await execute(started.steps[0].jobId, invoke);
  // Model execution has settled, but publication has not committed: the same
  // persisted state left behind by a failed publication transaction in production.
  const recoveryTime = new Date(Date.now() + 60000);
  await recoverRuns(fixture.db, recoveryTime);
  const scheduled = await fixture.db.creationRun.findUnique({ where: { id: run.id } });
  expect(scheduled.nextCheckAt).toBeInstanceOf(Date);
  await advance(run.id); await advance(run.id);
  const done = await readRun(user.id, run.id, fixture.db);
  expect(done.status).toBe("succeeded");
  expect((await fixture.db.creationRun.findUnique({ where: { id: run.id } })).nextCheckAt).toEqual(scheduled.nextCheckAt);
  const wakes = () => fixture.db.outboxEvent.count({ where: { entityId: run.id, kind: "creation-advance" } });
  const wakeCount = await wakes();
  await recoverRuns(fixture.db, new Date(+recoveryTime + 60000));
  await advance(run.id);
  expect(await wakes()).toBe(wakeCount);
  expect(await fixture.db.tryOn.count({ where: { userId: user.id } })).toBe(1);
  expect(done.steps[0].result.disposition).toBe("created");
  expect((await readLayoutArtifact(user.id, done.steps[0].result.artifactId, undefined, options())).content.pages[0].html).toContain("10 月 24 日");
  const messages = await readMessages(user.id, sessionId, undefined, fixture.db);
  expect(messages.items.map(message => message.role)).toEqual(["user", "assistant"]);
  expect(invoke).toHaveBeenCalledTimes(1);
  expect((await usageSummary(user.id, fixture.db)).credits).toBe(98);
});

it("keeps manual edits and publishes a conflicting AI patch as an independent artwork", async () => {
  const { user, project, create, input } = await setup();
  const source = await createLayoutArtifact(user.id, project.id, poster(), randomUUID(), options());
  const run = await create({ ...input, prompt: "把日期改为 11 月 1 日", target: { artifactId: source.artifactId, baseRevision: 1, pageId: "page", nodeIds: ["date"] } });
  await advance(run.id);
  const jobId = (await readRun(user.id, run.id, fixture.db)).steps[0].jobId;
  await execute(jobId, async () => ({ operations: [{ op: "setText", pageId: "page", nodeId: "date", text: "11 月 1 日" }] }));
  await modifyLayoutArtifact(user.id, source.artifactId, { baseRevision: 1, saveKey: randomUUID(), operations: [{ op: "setText", pageId: "page", nodeId: "date", text: "手工修改" }] }, options());
  await advance(run.id); await advance(run.id);
  const done = await readRun(user.id, run.id, fixture.db), result = done.steps[0].result;
  expect(result.disposition).toBe("conflict-copy");
  expect(result.artifactId).not.toBe(source.artifactId);
  expect((await readLayoutArtifact(user.id, source.artifactId, undefined, options())).content.pages[0].nodes[0].text).toBe("手工修改");
  expect((await readLayoutArtifact(user.id, result.artifactId, undefined, options())).content.pages[0].nodes[0].text).toBe("11 月 1 日");
  expect(await fixture.db.creationArtifact.count({ where: { projectId: project.id } })).toBe(2);
});

it("resumes a failed publication from the same paid result without a new model request", async () => {
  const { user, create } = await setup(), run = await create();
  await advance(run.id);
  const started = await readRun(user.id, run.id, fixture.db), jobId = started.steps[0].jobId;
  const invoke = vi.fn(async () => poster()); await execute(jobId, invoke);
  await advance(run.id, { store: { ...store, put: async () => { throw new AppError("ARTIFACT_UPLOAD_EXPIRED", 409); } } });
  const paused = await readRun(user.id, run.id, fixture.db);
  expect(paused.status).toBe("awaiting_input");
  await resumeRun(user.id, run.id, { expectedSequence: paused.eventSequence, maxCredits: 2 }, fixture.db, {
    ...options(), configFor: async () => { throw new Error("no new model quote should be needed"); },
  });
  await advance(run.id);
  const done = await readRun(user.id, run.id, fixture.db);
  expect(done.status).toBe("succeeded"); expect(done.steps[0].jobId).toBe(jobId); expect(done.steps[0].attempt).toBe(0);
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(await fixture.db.tryOn.count({ where: { userId: user.id } })).toBe(1);
});

it("expands the outline once, generates pages serially and assembles one editable presentation", async () => {
  const { user, create } = await setup("slides"), run = await create();
  const invoke = vi.fn(async ({ input }) => input.purpose === "slides.outline"
    ? { title: "Coffee business", theme, pages: [{ id: "p1", title: "Opening", brief: "Introduce the shop", notes: "First speaker notes" }, { id: "p2", title: "Offer", brief: "Explain the offer" }] }
    : page(input.pageId, input.title));
  for (let index = 0; index < 12; index++) {
    await advance(run.id);
    const state = await readRun(user.id, run.id, fixture.db);
    if (state.status === "succeeded") break;
    if (state.errorCode === "CREATION_OUTLINE_CONFIRMATION_REQUIRED") {
      expect(state.steps).toHaveLength(1);
      expect(await fixture.db.tryOn.count({ where: { userId: user.id } })).toBe(1);
      const review = await readOutlineReview(user.id, run.id, options());
      await confirmOutline(user.id, run.id, { saveKey: randomUUID(), expectedSequence: review.expectedSequence, expectedUnitCost: review.unitCost, maxCredits: 6, outline: review.outline }, options());
      continue;
    }
    const pending = state.steps.find(step => step.jobId && step.status !== "succeeded");
    if (pending) await execute(pending.jobId, (_, context) => invoke(context));
  }
  const done = await readRun(user.id, run.id, fixture.db);
  expect(done.status).toBe("succeeded"); expect(done.steps).toHaveLength(4);
  expect(invoke).toHaveBeenCalledTimes(3);
  const artifact = await readLayoutArtifact(user.id, done.steps.at(-1).result.artifactId, undefined, options());
  expect(artifact.content.pages.map(page => page.id)).toEqual(["p1", "p2"]);
  expect(artifact.content.pages[0].notes).toBe("First speaker notes");
  expect((await usageSummary(user.id, fixture.db)).credits).toBe(94);
});

async function waitingOutline() {
  const context = await setup("slides"), run = await context.create();
  await advance(run.id);
  const jobId = (await readRun(context.user.id, run.id, fixture.db)).steps[0].jobId;
  await execute(jobId, async () => ({ title: "Original title", theme, pages: [
    { id: "a", title: "Original A", brief: "First page", notes: "Keep notes" },
    { id: "b", title: "Original B", brief: "Second page" },
  ] }));
  await advance(run.id);
  const review = await readOutlineReview(context.user.id, run.id, options());
  return { ...context, run, review, body: { saveKey: randomUUID(), expectedSequence: review.expectedSequence, expectedUnitCost: review.unitCost, maxCredits: 6, outline: review.outline } };
}

it("waits durably for outline approval and rejects normal resume or confirmation from another account", async () => {
  const { user, run, review, body } = await waitingOutline();
  expect(review.canConfirm).toBe(true);
  await advance(run.id); await advance(run.id);
  expect((await readRun(user.id, run.id, fixture.db)).status).toBe("awaiting_input");
  expect(await fixture.db.tryOn.count({ where: { userId: user.id } })).toBe(1);
  expect((await usageSummary(user.id, fixture.db)).credits).toBe(98);
  await expect(resumeRun(user.id, run.id, { expectedSequence: review.expectedSequence, maxCredits: 6 }, fixture.db, options())).rejects.toThrow("CREATION_OUTLINE_CONFIRMATION_REQUIRED");
  await expect(readOutlineReview("stranger", run.id, options())).rejects.toThrow("CREATION_RUN_NOT_FOUND");
  await expect(confirmOutline("stranger", run.id, body, options())).rejects.toThrow("CREATION_RUN_NOT_FOUND");
});

it("confirms edited/reordered pages once, preserves approved notes, and replays after a lost acknowledgement", async () => {
  const { user, run, body, review } = await waitingOutline();
  const edited = { ...body, outline: { ...review.outline, title: "Reviewed title", pages: [
    { ...review.outline.pages[1], title: "New first", brief: "Exactly the reviewed brief", notes: "Approved notes" },
    { ...review.outline.pages[0], notes: "" },
  ] } };
  const results = await Promise.all([confirmOutline(user.id, run.id, edited, options()), confirmOutline(user.id, run.id, edited, options())]);
  expect(results[0].id).toBe(results[1].id);
  expect(results[0].steps).toHaveLength(4);
  expect((await confirmOutline(user.id, run.id, edited, { ...options(), env: {} })).id).toBe(run.id);
  await expect(confirmOutline(user.id, run.id, { ...edited, outline: { ...edited.outline, title: "Other tab" } }, options())).rejects.toThrow("CREATION_OUTLINE_ALREADY_CONFIRMED");
  const accepted = await readOutlineReview(user.id, run.id, options());
  expect(accepted.outline).toEqual(edited.outline); expect(accepted.confirmed).toBe(true); expect(accepted.canConfirm).toBe(false);
  const invoke = vi.fn(async (_config, { input }) => ({ ...page(input.pageId, input.title), notes: "Model notes must not overwrite approved notes" }));
  for (let i = 0; i < 10; i++) {
    await advance(run.id);
    const state = await readRun(user.id, run.id, fixture.db);
    if (state.status === "succeeded") break;
    const pending = state.steps.find(step => step.jobId && step.status !== "succeeded");
    if (pending) await execute(pending.jobId, invoke);
  }
  const done = await readRun(user.id, run.id, fixture.db);
  expect(done.status).toBe("succeeded"); expect(invoke).toHaveBeenCalledTimes(2);
  expect(invoke.mock.calls[0][1].input.brief).toBe("Exactly the reviewed brief");
  const artifact = await readLayoutArtifact(user.id, done.steps.at(-1).result.artifactId, undefined, options());
  expect(artifact.content.title).toBe("Reviewed title");
  expect(artifact.content.pages.map(page => page.id)).toEqual(["b", "a"]);
  expect(artifact.content.pages.map(page => page.notes)).toEqual(["Approved notes", ""]);
  expect((await usageSummary(user.id, fixture.db)).credits).toBe(94);
});

it("rechecks price and total budget when the user adds pages before confirmation", async () => {
  const { user, run, body } = await waitingOutline();
  const extended = { ...body, outline: { ...body.outline, pages: [...body.outline.pages, { id: "extra", title: "Extra", brief: "Added by user", notes: "" }] } };
  await expect(confirmOutline(user.id, run.id, extended, options())).rejects.toThrow("CREATION_BUDGET_EXCEEDED");
  await expect(confirmOutline(user.id, run.id, { ...extended, maxCredits: 20 }, { ...options(), configFor: async () => ({ ...config, plannerCreditCost: 3 }) })).rejects.toThrow("PRICE_CHANGED");
  const accepted = await confirmOutline(user.id, run.id, { ...extended, maxCredits: 11, expectedUnitCost: 3 }, { ...options(), configFor: async () => ({ ...config, plannerCreditCost: 3 }) });
  expect(accepted.steps).toHaveLength(5);
  expect(accepted.steps.filter(step => step.tool === "slides.page").every(step => step.expectedCost === 3)).toBe(true);
  expect(accepted.committedCredits).toBe(2); // confirmation itself never charges
});

it("does not schedule page generation if cancellation wins during approved-outline upload", async () => {
  const { user, run, body } = await waitingOutline();
  await expect(confirmOutline(user.id, run.id, body, { ...options(), store: { ...store, put: async (key, bytes) => {
    await store.put(key, bytes); await cancelRun(user.id, run.id, fixture.db);
  } } })).rejects.toThrow("CREATION_RUN_CHANGED");
  await advance(run.id);
  const state = await readRun(user.id, run.id, fixture.db);
  expect(state.status).toBe("cancelled"); expect(state.steps).toHaveLength(1);
  expect(await fixture.db.tryOn.count({ where: { userId: user.id } })).toBe(1);
});

it("does not expose an artifact when cancellation wins during its upload", async () => {
  const { user, project, create } = await setup(), run = await create();
  await advance(run.id);
  await execute((await readRun(user.id, run.id, fixture.db)).steps[0].jobId, async () => poster());
  await advance(run.id, { store: { ...store, put: async (key, bytes) => {
    await store.put(key, bytes); await cancelRun(user.id, run.id, fixture.db);
  } } });
  await advance(run.id);
  expect((await readRun(user.id, run.id, fixture.db)).status).toBe("cancelled");
  expect(await fixture.db.creationArtifact.count({ where: { projectId: project.id } })).toBe(0);
});

it("generates reviewed document sections durably and assembles their checkpoints without another paid invocation", async () => {
  const { user, create } = await setup("document"), run = await create();
  await advance(run.id);
  const first = (await readRun(user.id, run.id, fixture.db)).steps[0];
  await execute(first.jobId, async () => ({ title: "开业方案", sections: [{ id: "a", title: "概览", brief: "开业目标" }, { id: "b", title: "执行", brief: "执行安排" }] }));
  await advance(run.id);
  const waiting = await readRun(user.id, run.id, fixture.db);
  expect(waiting.status).toBe("awaiting_input"); expect(waiting.steps).toHaveLength(1);
  const review = await readOutlineReview(user.id, run.id, options());
  expect(review.kind).toBe("document");
  const approved = { ...review.outline, sections: review.outline.sections.toReversed() };
  const body = { saveKey: randomUUID(), expectedSequence: review.expectedSequence, expectedUnitCost: 2, maxCredits: 6, outline: approved };
  await confirmOutline(user.id, run.id, body, options());
  expect((await confirmOutline(user.id, run.id, body, { ...options(), env: {} })).steps).toHaveLength(4);
  const invoke = vi.fn(async (_config, { input }) => ({ id: input.sectionId, title: input.title, blocks: [{ id: "same-id", type: "paragraph", runs: [{ text: input.brief }] }] }));
  for (let i = 0; i < 10; i++) {
    await advance(run.id);
    const state = await readRun(user.id, run.id, fixture.db);
    if (state.status === "succeeded") break;
    const pending = state.steps.find(step => step.jobId && step.status !== "succeeded");
    if (pending) await execute(pending.jobId, invoke);
  }
  const done = await readRun(user.id, run.id, fixture.db);
  expect(done.status).toBe("succeeded"); expect(invoke).toHaveBeenCalledTimes(2);
  expect(invoke.mock.calls[0][1].input.audience).toBe("店长");
  const artifact = await readDocumentArtifact(user.id, done.steps.at(-1).result.artifactId, undefined, options());
  expect(artifact.content.sections.map(section => section.id)).toEqual(["b", "a"]);
  expect(artifact.content.sections[0].blocks[0].id).not.toBe(artifact.content.sections[1].blocks[0].id);
  expect((await usageSummary(user.id, fixture.db)).credits).toBe(94);
});
