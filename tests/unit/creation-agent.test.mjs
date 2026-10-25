import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const mocks = vi.hoisted(() => ({ read: vi.fn(), enqueue: vi.fn(), cancel: vi.fn(), message: vi.fn() }));
vi.mock("../../src/lib/prisma.js", () => ({ prisma: {} }));
vi.mock("../../src/lib/domain/billing/ledger.js", () => ({ lockUser: vi.fn(async () => ({ id: "u" })), reserveCreditLots: vi.fn() }));
vi.mock("../../src/lib/domain/creation/language-execution.js", () => ({ readCreationLanguageResult: mocks.read }));
vi.mock("../../src/lib/domain/generation/execution.js", () => ({ cancelOutput: mocks.cancel }));
vi.mock("../../src/lib/domain/creation/messages.js", () => ({ appendCreationMessage: mocks.message }));
vi.mock("../../src/lib/domain/creation/events.js", () => ({ enqueueRun: mocks.enqueue, appendRunEvent: async (tx, id, type, payload, changes = {}) => {
  const row = await tx.creationRun.update({ where: { id }, data: { ...changes, eventSequence: { increment: 1 } } });
  tx.events.push({ id, type, payload }); return row;
} }));
import { agentPlanSchema, agentRequestSchema } from "../../src/lib/creation/contracts/agent.js";
import { languageInputSchema, validateLanguageResult } from "../../src/lib/creation/contracts/language.js";
import { createAgentRun, advanceAgentRun, resumeAgentRun } from "../../src/lib/domain/creation/agent-runs.js";
import { verifiedAgentParent } from "../../src/lib/domain/creation/agent-links.js";
import { prepareDependencyContext } from "../../src/lib/domain/creation/dependency-context.js";
import { creationLanguageMessages } from "../../src/lib/domain/creation/language-provider.js";

const poster = { kind: "poster", prompt: "Coffee opening", width: 1080, height: 1440, maxCredits: 0 };
const contentStep = (id = "poster") => ({ id, tool: "content.create", explanation: "Design poster", dependsOn: [], request: poster });
const planInput = () => languageInputSchema.parse({ purpose: "agent.plan", prompt: "Poster then slides", allowedKinds: ["poster", "slides"], imageSizes: [], referenceIds: ["ref"] });
const configFor = async () => ({ visionApiKey: "test", chatModel: "test", plannerCreditCost: 1 });
const env = { CREATION_POSTER_ENABLED: "true", CREATION_RUNS_ENABLED: "true", CREATION_WORKSPACE_ENABLED: "true" };
function fixture() {
  const runs = new Map(), jobs = new Map(), exports = new Map();
  const run = { id: "root", userId: "u", projectId: "p", sessionId: "s", kind: "agent", status: "running", eventSequence: 1, committedCredits: 1, maxCredits: 20,
    input: { summary: "Poster then slides", locale: "zh", languageUnitCost: 1, assetIds: [], referenceIds: [], languageProvider: null }, steps: [] };
  runs.set(run.id, run);
  const update = (row, data) => { for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === "object" && "increment" in value ? (row[key] || 0) + value.increment : value && typeof value === "object" && "decrement" in value ? row[key] - value.decrement : value; return structuredClone(row); };
  const findStep = id => [...runs.values()].flatMap(row => row.steps).find(step => step.id === id);
  const findRun = where => [...runs.values()].find(row => (!where.id || row.id === where.id) && (!where.requestId || row.requestId === where.requestId) && (!where.userId || row.userId === where.userId));
  const db = { events: [], $queryRaw: vi.fn(),
    creationRun: {
      findFirst: vi.fn(async ({ where }) => structuredClone(findRun(where) || null)), findUnique: vi.fn(async ({ where }) => structuredClone(findRun(where) || null)),
      count: vi.fn(async () => 0), update: vi.fn(async ({ where, data }) => update(runs.get(where.id), data)),
      create: vi.fn(async ({ data }) => { const row = { ...data, id: "created", eventSequence: 0, status: "queued", committedCredits: 0, steps: data.steps.create }; runs.set(row.id, row); return structuredClone(row); }),
    },
    creationStep: {
      createMany: vi.fn(async ({ data }) => { for (const step of data) runs.get(step.runId).steps.push({ ...step, attempt: 0 }); }),
      update: vi.fn(async ({ where, data }) => update(findStep(where.id), data)),
      updateMany: vi.fn(async ({ where, data }) => { for (const step of runs.get(where.runId).steps.filter(item => item.status !== "succeeded")) update(step, data); }),
    },
    creationSession: { findFirst: vi.fn(async () => ({ projectId: "p" })) },
    creationProject: { findFirst: vi.fn(async () => ({ id: "p" })) },
    assetReference: { createMany: vi.fn(), upsert: vi.fn() },
    tryOn: { findFirst: vi.fn(async ({ where }) => structuredClone(jobs.get(where.id) || null)) },
    artifactExport: { findFirst: vi.fn(async ({ where }) => structuredClone(exports.get(where.id) || null)) },
  };
  db.$transaction = async fn => fn(db);
  return { db, run, runs, jobs, exports, store: {}, configFor, ensureWorkers: vi.fn(), quoteImage: async () => null, env, snapshot: () => structuredClone(run) };
}
beforeEach(() => { Object.values(mocks).forEach(mock => mock.mockReset()); });

it("validates a finite registered plan and rejects cycles, invented tools, side effects and wrong exports", () => {
  expect(agentPlanSchema.parse({ title: "Campaign", steps: [contentStep(), { id: "export", tool: "artifact.export", explanation: "Export", dependsOn: ["poster"], sourceStepId: "poster", format: "pdf" }] }).steps).toHaveLength(2);
  for (const steps of [[{ ...contentStep(), dependsOn: ["poster"] }], [{ ...contentStep(), tool: "shell.exec" }], [contentStep(), { id: "x", tool: "artifact.export", explanation: "Export", dependsOn: ["poster"], sourceStepId: "poster", format: "xlsx" }], Array.from({ length: 17 }, (_, index) => contentStep(`s${index}`))]) expect(agentPlanSchema.safeParse({ title: "x", steps }).success).toBe(false);
});
it("only admits enabled kinds, supplied references and the exact user-selected edit scope", () => {
  expect(() => validateLanguageResult(planInput(), { title: "x", steps: [{ ...contentStep(), request: { kind: "web", prompt: "x", maxCredits: 0 } }] })).toThrow("AGENT_PLAN_SCOPE_INVALID");
  expect(() => validateLanguageResult(planInput(), { title: "x", steps: [{ id: "read", tool: "reference.read", explanation: "Read", dependsOn: [], referenceIds: ["foreign"] }] })).toThrow("AGENT_PLAN_SCOPE_INVALID");
  const editRequest = { ...poster, target: { artifactId: "a", baseRevision: 1, pageId: "page", nodeIds: ["title"] } };
  const input = languageInputSchema.parse({ ...planInput(), editRequest });
  const plan = { title: "x", steps: [{ ...contentStep(), tool: "content.edit", request: editRequest }] };
  expect(validateLanguageResult(input, plan).steps).toHaveLength(1);
  plan.steps[0].request.target.nodeIds = [];
  expect(() => validateLanguageResult(input, plan)).toThrow("AGENT_PLAN_SCOPE_INVALID");
});
it("does not allow client-supplied internal parent links or executor code", () => {
  expect(agentRequestSchema.safeParse({ kind: "agent", prompt: "x", maxCredits: 10, agentParent: { runId: "other" } }).success).toBe(false);
  const messages = creationLanguageMessages({ input: planInput(), assets: [] });
  expect(messages[0].content).toContain("content.create");
  expect(messages[0].content).not.toContain("Every node:");
});
it("rejects over-wide artifact fan-in and applies normal active-run limits on resume", async () => {
  const inputs = Array.from({ length: 9 }, (_, i) => contentStep(`source-${i}`));
  expect(agentPlanSchema.safeParse({ title: "Too wide", steps: [...inputs, { ...contentStep("join"), dependsOn: inputs.map(item => item.id) }] }).success).toBe(false);
  const f = fixture(); f.run.status = "failed";
  f.db.creationRun.count.mockResolvedValue(1);
  await expect(resumeAgentRun("u", f.snapshot(), { expectedSequence: 1, maxCredits: 20, retryFailed: true }, f)).rejects.toThrow("CREATION_USER_QUEUE_FULL");
  expect(f.run.status).toBe("failed");
});
it("creates one durable planner and replays the same key without new admission or message", async () => {
  const f = fixture(), request = { kind: "agent", prompt: "Poster", maxCredits: 10 };
  const first = await createAgentRun("u", "s", request, "agent-create-key-123", f);
  expect(first.kind).toBe("agent"); expect(first.steps[0].tool).toBe("agent.plan");
  const again = await createAgentRun("u", "s", request, "agent-create-key-123", f);
  expect(again.id).toBe(first.id); expect(f.ensureWorkers).toHaveBeenCalledTimes(1); expect(mocks.message).toHaveBeenCalledTimes(1);
  await expect(createAgentRun("u", "s", { ...request, prompt: "Different" }, "agent-create-key-123", f)).rejects.toThrow("IDEMPOTENCY_CONFLICT");
});
it("publishes a paid plan once and waits for explicit approval before child admission", async () => {
  const f = fixture();
  f.run.steps = [{ id: "plan", tool: "agent.plan", jobId: "job", status: "running", dependsOn: [], params: planInput() }];
  f.jobs.set("job", { status: "succeeded" }); mocks.read.mockResolvedValue({ title: "Campaign", steps: [contentStep()] });
  const createChild = vi.fn(); await advanceAgentRun(f.snapshot(), { ...f, createChild });
  expect(f.run.status).toBe("awaiting_input"); expect(f.run.errorCode).toBe("CREATION_AGENT_PLAN_CONFIRMATION_REQUIRED"); expect(createChild).not.toHaveBeenCalled();
  expect(f.run.steps[1].status).toBe("blocked");
  await resumeAgentRun("u", f.snapshot(), { expectedSequence: f.run.eventSequence, maxCredits: 20, retryFailed: false }, f);
  expect(f.run.steps[1].status).toBe("ready");
});
it("supplies fixed revision dependencies to a typed child and never copies full parent artifacts", async () => {
  const f = fixture(); f.run.steps = [
    { id: "source", status: "succeeded", dependsOn: [], result: { artifactId: "a", revision: 3 } },
    { id: "next", status: "ready", dependsOn: ["source"], tool: "content.create", params: contentStep() },
  ];
  const createChild = vi.fn(); await advanceAgentRun(f.snapshot(), { ...f, createChild });
  expect(createChild.mock.calls[0][2].maxCredits).toBe(19);
  expect(createChild.mock.calls[0][4]).toMatchObject({ dependencyRefs: [{ artifactId: "a", revision: 3 }], agentLink: { runId: "root", stepId: "next", sequence: 1 } });
});
it("accounts child spend once and releases only dependent steps after success", async () => {
  const f = fixture(); f.run.steps = [
    { id: "s1", status: "running", tool: "content.create", dependsOn: [], result: { childRunId: "child", accountedCredits: 0 } },
    { id: "s2", status: "blocked", tool: "content.create", dependsOn: ["s1"] },
  ];
  f.runs.set("child", { id: "child", userId: "u", projectId: "p", sessionId: "s", status: "running", committedCredits: 4, input: { agentParent: { runId: "root", stepId: "s1" } }, steps: [] });
  const createChild = vi.fn();
  await advanceAgentRun(f.snapshot(), { ...f, createChild }); await advanceAgentRun(f.snapshot(), { ...f, createChild });
  expect(f.run.committedCredits).toBe(5); expect(createChild).not.toHaveBeenCalled(); expect(f.run.steps[1].status).toBe("blocked");
  Object.assign(f.runs.get("child"), { status: "succeeded", steps: [{ result: { artifactId: "output", revision: 2 } }] });
  await advanceAgentRun(f.snapshot(), f);
  expect(f.run.steps[0].result).toMatchObject({ artifactId: "output", revision: 2 }); expect(f.run.steps[1].status).toBe("ready"); expect(f.run.committedCredits).toBe(5);
});
it("pauses the parent for child outline review instead of automatically approving it", async () => {
  const f = fixture(); f.run.steps = [{ id: "s1", status: "running", tool: "content.create", dependsOn: [], result: { childRunId: "child" } }];
  f.runs.set("child", { id: "child", userId: "u", status: "awaiting_input", errorCode: "CREATION_OUTLINE_CONFIRMATION_REQUIRED", committedCredits: 1, input: { agentParent: { runId: "root", stepId: "s1" } }, steps: [] });
  await advanceAgentRun(f.snapshot(), f);
  expect(f.run.status).toBe("awaiting_input"); expect(f.run.errorCode).toBe("CREATION_OUTLINE_CONFIRMATION_REQUIRED"); expect(f.run.steps[0].status).toBe("running");
});
it("ends a parent when its child is cancelled instead of offering an impossible retry", async () => {
  const f = fixture();
  f.run.steps = [{ id: "s1", status: "running", tool: "content.create", dependsOn: [], result: { childRunId: "child", accountedCredits: 2 } }, { id: "s2", status: "blocked", dependsOn: ["s1"] }];
  f.run.committedCredits = 3;
  f.runs.set("child", { id: "child", userId: "u", status: "cancelled", committedCredits: 1, input: { agentParent: { runId: "root", stepId: "s1" } }, steps: [] });
  await advanceAgentRun(f.snapshot(), f);
  expect(f.run.status).toBe("cancelled"); expect(f.run.committedCredits).toBe(2);
  expect(f.run.steps.every(step => step.status === "cancelled")).toBe(true);
});
it("stops new steps after cancellation and settles a refunded planner exactly once", async () => {
  const f = fixture(); f.run.cancelRequestedAt = new Date(); f.run.status = "cancelling";
  f.run.steps = [{ id: "plan", tool: "agent.plan", jobId: "job", status: "running" }, { id: "future", status: "blocked" }];
  f.jobs.set("job", { status: "cancelled", creditCost: 1 });
  const createChild = vi.fn(); await advanceAgentRun(f.snapshot(), { ...f, createChild });
  expect(f.run.status).toBe("cancelled"); expect(f.run.committedCredits).toBe(0); expect(createChild).not.toHaveBeenCalled(); expect(f.run.steps.every(step => step.status === "cancelled")).toBe(true);
});
it("records export identity in the same transaction and rejects a stale parent before submission", async () => {
  const f = fixture(); f.run.steps = [{ id: "source", status: "succeeded", result: { artifactId: "a", revision: 4 } }, { id: "export", tool: "artifact.export", status: "ready", dependsOn: ["source"], params: { sourceStepId: "source", format: "pdf" } }];
  const requestExport = vi.fn(async (_user, _id, input, { hooks }) => { await hooks.beforeCommit(f.db); expect(input.revision).toBe(4); await hooks.afterCommit(f.db, { id: "ex" }); });
  const snapshot = f.snapshot(); await advanceAgentRun(snapshot, { ...f, requestExport });
  expect(f.run.steps[1].result.exportId).toBe("ex");
  await expect(advanceAgentRun(snapshot, { ...f, requestExport })).rejects.toThrow("CREATION_RUN_CHANGED");
});
it("requires reciprocal ownership links before sharing a user's admission slot", async () => {
  const f = fixture(), child = { id: "child", userId: "u", projectId: "p", sessionId: "s", input: { agentParent: { runId: "root", stepId: "s1" } } };
  f.run.steps = [{ id: "s1", result: { childRunId: "different" } }];
  await expect(verifiedAgentParent(f.db, child)).rejects.toThrow("CREATION_AGENT_LINK_INVALID");
  f.run.steps[0].result.childRunId = "child";
  expect((await verifiedAgentParent(f.db, child)).id).toBe("root");
  f.run.cancelRequestedAt = new Date(); await expect(verifiedAgentParent(f.db, child)).rejects.toThrow("CREATION_PUBLICATION_STOPPED");
});
it("loads bounded source text from an owned immutable revision and rejects corruption", async () => {
  const bytes = Buffer.from(JSON.stringify({ title: "Coffee", pages: [{ html: "<h1>Opening 11/1</h1><style>secret-css</style><script>bad()</script>" }] }));
  const blob = { userId: "u", state: "ready", bytes: bytes.length, checksum: createHash("sha256").update(bytes).digest("hex"), objectKey: "private" };
  const db = { creationRun: { findFirst: vi.fn(async () => ({ projectId: "p" })) }, artifactRevision: { findFirst: vi.fn(async () => ({ blob })) } }, store = { get: vi.fn(async () => bytes) };
  const refs = [{ artifactId: "a", revision: 3 }];
  const result = await prepareDependencyContext("u", "root", refs, { db, store });
  expect(result[0].text).toContain("Opening 11/1"); expect(result[0].text).not.toContain("bad()"); expect(result[0].text).not.toContain("secret-css");
  expect(db.artifactRevision.findFirst.mock.calls[0][0].where).toMatchObject({ revision: 3, artifact: { projectId: "p", deletedAt: null } });
  blob.checksum = "wrong"; await expect(prepareDependencyContext("u", "root", refs, { db, store })).rejects.toThrow("ARTIFACT_INTEGRITY_FAILED");
});
