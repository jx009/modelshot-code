import { beforeEach, expect, it, vi } from "vitest";
import { videoRunSchema } from "../../src/lib/creation/contracts/video-runs.js";
import { digestJson } from "../../src/lib/domain/generation/contracts.js";
import { priceVideoShots } from "../../src/lib/domain/creation/video-runs.js";
import { createStoryboardRun, storyboardRunSchema } from "../../src/lib/domain/creation/storyboard-runs.js";

const mocks = vi.hoisted(() => ({ config: vi.fn(), caps: vi.fn() }));
vi.mock("../../src/lib/domain/studio/providers.js", () => ({ studioConfig: (...args) => mocks.config(...args), capabilities: (...args) => mocks.caps(...args) }));
const env = { CREATION_WORKSPACE_ENABLED: "true", CREATION_VIDEO_ENABLED: "true", CREATION_MOTION_ENABLED: "true", CREATION_RUNS_ENABLED: "true" };
const input = () => ({ documentId: "composition", documentVersion: 1, summary: "Two shots", maxCredits: 40,
  shots: [{ sceneId: "first", provider: "video-provider", params: { prompt: "First shot", duration: 5, ratio: "16:9", media: [] } }, { sceneId: "second", provider: "video-provider", params: { prompt: "Second shot", duration: 5, ratio: "16:9", media: [] } }], expectedCosts: [20, 20] });
beforeEach(() => { mocks.config.mockReset(); mocks.caps.mockReset(); });

it("rejects duplicate scene identities and mismatched per-shot quotes", () => {
  expect(videoRunSchema.safeParse(input()).success).toBe(true);
  expect(videoRunSchema.safeParse({ ...input(), shots: [input().shots[0], input().shots[0]] }).success).toBe(false);
  expect(videoRunSchema.safeParse({ ...input(), expectedCosts: [20] }).success).toBe(false);
});

it("recovers an accepted storyboard run before checking current prices, workers or the document", async () => {
  const body = { documentId: "composition", documentVersion: 1, sceneIds: ["first", "second"], maxCredits: 40, expectedTotal: 40 };
  const parsed = storyboardRunSchema.parse(body);
  const row = { id: "accepted-run", userId: "owner", kind: "storyboard", input: { summary: "two shots" }, digest: digestJson({ ...parsed, documentVersion: undefined }), steps: [], status: "running" };
  const db = { creationRun: { findUnique: vi.fn().mockResolvedValue(row) }, $transaction: vi.fn() };
  expect((await createStoryboardRun("owner", { ...body, documentVersion: 7 }, "unchanged-plan-key", db, env)).id).toBe("accepted-run");
  expect(mocks.config).not.toHaveBeenCalled(); expect(db.$transaction).not.toHaveBeenCalled();
  await expect(createStoryboardRun("owner", { ...body, maxCredits: 100 }, "unchanged-plan-key", db, env)).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  expect(storyboardRunSchema.safeParse({ ...body, sceneIds: ["first", "first"] }).success).toBe(false);
});

it("quotes each shot from the pinned channel and shares capability reads", async () => {
  mocks.config.mockResolvedValue({ videoProvider: "video-provider", videoOptions: { durations: [5], ratios: ["16:9"], inputMode: "text" } });
  mocks.caps.mockResolvedValue({ tools: [{ id: "video", available: true, cost: 20 }] });
  const steps = input().shots.map(params => ({ params }));
  expect(await priceVideoShots(steps, undefined, {})).toEqual({ costs: [20, 20], providers: ["video-provider", "video-provider"] });
  expect(mocks.config).toHaveBeenCalledTimes(1); expect(mocks.caps).toHaveBeenCalledTimes(1);
  await expect(priceVideoShots([{ params: { ...input().shots[0], params: { ...input().shots[0].params, duration: 10 } } }], undefined, {})).rejects.toThrow("VIDEO_DURATION_UNSUPPORTED");
});
