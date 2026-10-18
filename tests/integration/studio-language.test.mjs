import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { domainFixture } from "../support/domain-fixture.mjs";
import { languageCall, recoverLanguageCall } from "../../src/lib/domain/studio/language.js";
import { usageSummary } from "../../src/lib/domain/billing/ledger.js";
import { reconcileLedger } from "../../src/lib/domain/billing/reconciliation.js";

let f;
const config = { visionApiKey: "fixture", chatModel: "fixture-chat", plannerCreditCost: 3 };
beforeAll(async () => { f = await domainFixture(); });
afterAll(async () => { await f?.cleanup(); });

it("charges once for validated language output and replays without invoking again", async () => {
  const user = await f.user(20), key = randomUUID(); let calls = 0;
  const invoke = async () => { calls++; return { summary: "plan" }; };
  const result = await languageCall(user.id, "plan", { prompt: "hello" }, key, config, invoke, f.db);
  expect(result).toEqual({ summary: "plan", languageCost: 3 });
  expect(await languageCall(user.id, "plan", { prompt: "hello" }, key, config, invoke, f.db)).toEqual(result);
  expect(calls).toBe(1);
  expect((await usageSummary(user.id, f.db)).credits).toBe(17);
  expect(await f.db.creditTransaction.count({ where: { userId: user.id, type: "consume" } })).toBe(1);
  await expect(languageCall(user.id, "plan", { prompt: "changed" }, key, config, invoke, f.db)).rejects.toThrow("IDEMPOTENCY_CONFLICT");
});

it("preserves the full language input and retains owned reference images for audit", async () => {
  const user = await f.user(20);
  const input = { message: "为商品设计一组有自然光的视觉方案", productAssetId: user.asset.id, referenceAssetId: user.asset.id, brief: { style: "自然光" } };
  await languageCall(user.id, "commerce-agent", input, randomUUID(), config, async () => ({ summary: "方案已生成" }), f.db);
  const row = await f.db.tryOn.findFirst({ where: { userId: user.id } });
  expect(row.prompt).toBe(input.message);
  expect(row.snapshot.input).toEqual(input);
  expect(await f.db.assetReference.findMany({ where: { entityId: row.id, kind: "generation_input" } })).toMatchObject([{ assetId: user.asset.id }]);
  const stranger = await f.user(20);
  await expect(languageCall(stranger.id, "commerce-agent", input, randomUUID(), config, async () => { throw new Error("must not invoke"); }, f.db)).rejects.toThrow("ASSET_NOT_FOUND");
  expect(await f.db.tryOn.count({ where: { userId: stranger.id } })).toBe(0);
});

it("reserves before invocation, rejects concurrent replay and releases failures", async () => {
  const user = await f.user(20), key = randomUUID();
  await expect(languageCall(user.id, "plan", {}, key, config, async () => {
    expect((await usageSummary(user.id, f.db)).reservedCredits).toBe(3);
    await expect(languageCall(user.id, "plan", {}, key, config, async () => { throw new Error("must not invoke"); }, f.db)).rejects.toThrow("REQUEST_IN_PROGRESS");
    throw new Error("invalid provider JSON");
  }, f.db)).rejects.toThrow("invalid provider JSON");
  expect((await usageSummary(user.id, f.db))).toMatchObject({ credits: 20, reservedCredits: 0 });
  const poor = await f.user(2); let called = false;
  await expect(languageCall(poor.id, "plan", {}, randomUUID(), config, async () => { called = true; return {}; }, f.db)).rejects.toThrow("INSUFFICIENT_CREDITS");
  expect(called).toBe(false);
});

it("recovers an expired request without allowing its late result to charge", async () => {
  const user = await f.user(20);
  await expect(languageCall(user.id, "plan", {}, randomUUID(), config, async () => {
    const row = await f.db.tryOn.findFirst({ where: { userId: user.id } });
    await f.db.tryOn.update({ where: { id: row.id }, data: { leaseUntil: new Date(0) } });
    await recoverLanguageCall(row.id, f.db);
    return { summary: "too late" };
  }, f.db)).rejects.toThrow("REQUEST_EXPIRED");
  expect((await usageSummary(user.id, f.db))).toMatchObject({ credits: 20, reservedCredits: 0 });
  expect((await reconcileLedger(f.db)).ok).toBe(true);
});
