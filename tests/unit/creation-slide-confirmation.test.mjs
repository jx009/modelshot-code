import { expect, it, vi } from "vitest";
import { confirmOutline, OUTLINE_CONFIRMATION_REQUIRED } from "../../src/lib/domain/creation/outline-review.js";
import { digestJson } from "../../src/lib/domain/generation/contracts.js";
import { confirmOutlineSchema } from "../../src/lib/creation/contracts/outline-review.js";
import { appendRunEvent } from "../../src/lib/domain/creation/events.js";

vi.mock("../../src/lib/prisma.js", () => ({ prisma: {} }));
vi.mock("../../src/lib/domain/creation/events.js", () => ({ appendRunEvent: vi.fn(async () => ({ eventSequence: 2 })), enqueueRun: vi.fn() }));
vi.mock("../../src/lib/domain/creation/messages.js", () => ({ appendCreationMessage: vi.fn() }));
function fixture() {
  const theme = { name: "Launch", primary: "#123456", accent: "#dd6600", background: "#ffffff", fontFamily: "sans" };
  const outline = { title: "Launch", theme, design: { audience: "Teams", narrative: "Problem to solution", artDirection: "Editorial", typography: "64px/28px", spacing: "64px", visuals: [{ id: "hero", prompt: "A quiet workspace" }] },
    pages: [{ id: "page", title: "Launch", brief: "Explain the product", visualId: "hero" }] };
  const data = { saveKey: "confirm-slides-key-123", expectedSequence: 1, expectedUnitCost: 2, maxCredits: 8, outline, image: { size: "1536x1024", expectedCost: 4, provider: "images" } };
  const run = { id: "run", userId: "owner", projectId: "project", sessionId: "session", kind: "slides", eventSequence: 1, status: "awaiting_input", errorCode: OUTLINE_CONFIRMATION_REQUIRED, maxCredits: 4, committedCredits: 2,
    input: { width: 1280, height: 720, languageProvider: null }, steps: [{ id: "outline", position: 0, tool: "slides.outline", status: "succeeded", params: { purpose: "slides.outline", sourceFormat: "html", prompt: "Launch", pageCount: 1, assetIds: [], referenceIds: [] }, result: {} }] };
  const db = { $queryRaw: async () => [], creationRun: { findFirst: async () => run, findUnique: async () => run, count: async () => 0 }, creationProject: { findFirst: async () => ({ id: "project" }) },
    creationStep: { createMany: vi.fn(), update: vi.fn() }, creationBlob: { create: vi.fn(async ({ data }) => ({ ...data, id: "blob" })), updateMany: async () => ({ count: 1 }) } };
  db.$transaction = async fn => fn(db);
  return { data, run, db, store: { put: vi.fn() }, env: { CREATION_RUNS_ENABLED: "true", CREATION_WORKSPACE_ENABLED: "true", CREATION_SLIDES_ENABLED: "true" },
    configFor: async () => ({ visionApiKey: "fixture", chatModel: "fixture", plannerCreditCost: 2 }), ensureWorkers: vi.fn(),
    quoteImage: vi.fn(async () => ({ provider: "images", prices: { "1536x1024": 4 } })) };
}

it.each(["budget", "price", "provider", "asset-limit"])("rejects %s before persisting or enqueueing paid illustration steps", async reason => {
  const f = fixture();
  const expected = { budget: "CREATION_BUDGET_EXCEEDED", price: "PRICE_CHANGED", provider: "PROVIDER_CONFIGURATION_CHANGED", "asset-limit": "CREATION_REFERENCE_INVALID" }[reason];
  if (reason === "budget") f.data.maxCredits = 7;
  if (reason === "price") f.quoteImage.mockResolvedValue({ provider: "images", prices: { "1536x1024": 5 } });
  if (reason === "provider") f.quoteImage.mockResolvedValue({ provider: "other", prices: { "1536x1024": 4 } });
  if (reason === "asset-limit") f.run.steps[0].params.assetIds = Array.from({ length: 8 }, (_, n) => "asset-" + n);
  await expect(confirmOutline("owner", "run", f.data, f)).rejects.toThrow(expected);
  expect(f.db.creationBlob.create).not.toHaveBeenCalled();
  expect(f.db.creationStep.createMany).not.toHaveBeenCalled();
});

it("persists image and page steps with correct page counts and replays the accepted confirmation without repricing", async () => {
  const f = fixture();
  await confirmOutline("owner", "run", f.data, f);
  expect(f.ensureWorkers).toHaveBeenCalledWith(f.db, { kind: "slides", posterImage: true });
  const steps = f.db.creationStep.createMany.mock.calls[0][0].data;
  expect(steps.map(step => step.tool)).toEqual(["poster.image", "slides.page", "layout.assemble"]);
  expect(steps.map(step => step.position)).toEqual([1, 2, 3]);
  expect(steps[1].dependsOn).toEqual(["outline", steps[0].id]);
  expect(appendRunEvent).toHaveBeenCalledWith(f.db, "run", "outline.confirmed", { pageCount: 1, maxCredits: 8 }, expect.objectContaining({ input: expect.objectContaining({ pageCount: 1 }) }));
  const digest = digestJson(confirmOutlineSchema.parse(f.data));
  f.run.steps[0].result.confirmation = { key: f.data.saveKey, digest, blobId: "blob" };
  f.run.status = "queued"; f.run.eventSequence = 2;
  await confirmOutline("owner", "run", f.data, f);
  expect(f.quoteImage).toHaveBeenCalledTimes(1);
  expect(f.db.creationStep.createMany).toHaveBeenCalledTimes(1);
  expect(f.store.put).toHaveBeenCalledTimes(1);
});

it("confirms an outline without blocking on another session", async () => {
  const state = fixture();
  state.db.creationRun.count = vi.fn(async ({ where }) => where.userId && where.sessionId !== "session" ? 1 : 0);
  await confirmOutline("owner", "run", state.data, state);
  expect(state.db.creationRun.count).toHaveBeenCalledWith({ where: { userId: "owner", sessionId: "session", id: { notIn: ["run"] }, status: { in: expect.arrayContaining(["running", "awaiting_input"]) } } });
  expect(state.db.creationStep.createMany).toHaveBeenCalledOnce();
});

it("does not confirm an outline over another plan in the same session", async () => {
  const state = fixture();
  state.db.creationRun.count = vi.fn(async () => 1);
  await expect(confirmOutline("owner", "run", state.data, state)).rejects.toThrow("CREATION_SCOPE_BUSY");
  expect(state.db.creationStep.createMany).not.toHaveBeenCalled();
});
