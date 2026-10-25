import { beforeEach, expect, it, vi } from "vitest";
import { publishCreationLanguage, assembleCreationSlides } from "../../src/lib/domain/creation/publication.js";
import { AppError } from "../../src/lib/http.js";

const ports = vi.hoisted(() => ({ result: vi.fn(), create: vi.fn(), read: vi.fn(), modify: vi.fn() }));
vi.mock("../../src/lib/prisma.js", () => ({ prisma: {} }));
vi.mock("../../src/lib/domain/creation/language-execution.js", () => ({ readCreationLanguageResult: (...args) => ports.result(...args) }));
vi.mock("../../src/lib/domain/creation/artifacts.js", () => ({ createLayoutArtifact: (...args) => ports.create(...args), readLayoutArtifact: (...args) => ports.read(...args), modifyLayoutArtifact: (...args) => ports.modify(...args) }));
vi.mock("../../src/lib/domain/creation/messages.js", () => ({ appendCreationMessage: vi.fn() }));
beforeEach(() => Object.values(ports).forEach(port => port.mockReset()));

function fixture() {
  const theme = { name: "Deck", primary: "#123456", accent: "#ff6600", background: "#ffffff", fontFamily: "sans" };
  const outline = { title: "Launch", theme, pages: ["a", "b"].map(id => ({ id, title: id, brief: "Facts", notes: `Approved ${id}` })) };
  const steps = ["a", "b"].map((id, i) => ({ id, position: i + 1, tool: "slides.page", status: "running", jobId: `job-${id}`, attempt: 0, dependsOn: ["outline"],
    params: { purpose: "slides.page", sourceFormat: "html", prompt: "Launch", pageId: id, title: id, brief: "Facts", theme, width: 1280, height: 720, assetIds: [] } }));
  const run = { id: "run", userId: "u", projectId: "project", kind: "slides", status: "running", eventSequence: 1, input: { locale: "en" }, steps: [
    { id: "outline", position: 0, tool: "slides.outline", status: "succeeded", jobId: "outline-job", dependsOn: [], params: { sourceFormat: "html" } }, ...steps,
    { id: "assemble", tool: "layout.assemble", status: "blocked", dependsOn: ["a", "b"], params: {} },
  ] };
  let artifact;
  const db = { $queryRaw: vi.fn(), creationRun: { findFirst: async () => structuredClone(run), update: async ({ data }) => { const { eventSequence, ...rest } = data; Object.assign(run, rest); run.eventSequence += eventSequence?.increment || 0; return structuredClone(run); } },
    creationStep: { update: async ({ where, data }) => Object.assign(run.steps.find(step => step.id === where.id), data) },
    tryOn: { findFirst: async ({ where }) => ({ status: "succeeded", snapshot: { creationStepId: where.id.slice(4), creationAttempt: 0 } }) },
    creationEvent: { create: vi.fn() }, outboxEvent: { create: vi.fn(), upsert: vi.fn() },
  };
  let tail = Promise.resolve();
  db.$transaction = callback => { const result = tail.then(() => callback(db)); tail = result.catch(() => {}); return result; };
  ports.result.mockImplementation(async (_user, jobId) => jobId === "outline-job" ? outline : { id: jobId.slice(4), width: 1280, height: 720, html: `<h1>${jobId}</h1>` });
  ports.create.mockImplementation(async (_user, _project, content, _key, options) => db.$transaction(async tx => {
    await options.hooks.beforeCommit(tx);
    artifact = { id: "artifact", revision: 1, content: structuredClone(content) };
    const saved = { artifactId: artifact.id, revision: artifact.revision };
    await options.hooks.afterCommit(tx, saved); return saved;
  }));
  ports.read.mockImplementation(async () => structuredClone(artifact));
  ports.modify.mockImplementation(async (_user, _id, change, options) => db.$transaction(async tx => {
    await options.hooks.beforeCommit(tx);
    if (artifact.revision !== change.baseRevision) throw new AppError("ARTIFACT_VERSION_CONFLICT", 409);
    for (const op of change.operations) artifact.content.pages.splice(op.index, 0, op.page);
    artifact.revision++; const saved = { artifactId: artifact.id, revision: artifact.revision };
    await options.hooks.afterCommit(tx, saved); return saved;
  }));
  return { run, db, store: {}, artifact: () => artifact };
}

it("publishes later pages early, keeps user edits and finishes assembly only after every page", async () => {
  const f = fixture();
  const publish = async id => { const current = structuredClone(f.run); await publishCreationLanguage(current, current.steps.find(step => step.id === id), f); };
  await publish("b");
  expect(f.run.status).toBe("running"); expect(f.run.steps.at(-1).status).toBe("blocked");
  f.artifact().content.pages[0].html = '<h1 data-node-id="edited">User edit</h1>'; f.artifact().revision++;
  await publish("a");
  expect(f.artifact().content.pages.map(page => page.id)).toEqual(["a", "b"]);
  expect(f.artifact().content.pages[1].html).toContain("User edit");
  expect(f.artifact().content.pages[0].notes).toBe("Approved a");
  expect(f.run.steps.at(-1).status).toBe("ready"); expect(ports.create).toHaveBeenCalledOnce();
  await assembleCreationSlides(structuredClone(f.run), structuredClone(f.run.steps.at(-1)), f);
  expect(f.run.status).toBe("succeeded");
  expect(f.run.steps.at(-1).result.artifactId).toBe("artifact");
});

it("allows only one first-artifact commit from concurrent completions and recovers the other page", async () => {
  const f = fixture(), first = structuredClone(f.run), second = structuredClone(f.run);
  const outcomes = await Promise.allSettled([publishCreationLanguage(first, first.steps[1], f), publishCreationLanguage(second, second.steps[2], f)]);
  expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.find(result => result.status === "rejected").reason.code).toBe("CREATION_RUN_CHANGED");
  const remaining = f.run.steps.find(step => step.tool === "slides.page" && step.status !== "succeeded");
  await publishCreationLanguage(structuredClone(f.run), structuredClone(remaining), f);
  expect(f.artifact().content.pages.map(page => page.id)).toEqual(["a", "b"]);
  expect(new Set(f.run.steps.filter(step => step.tool === "slides.page").map(step => step.result.artifactId))).toEqual(new Set(["artifact"]));
});
