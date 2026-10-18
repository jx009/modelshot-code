import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { domainFixture } from "../support/domain-fixture.mjs";
import { accountRecords } from "../../src/lib/domain/billing/account-records.js";
import { recordDetail, recordType } from "../../src/lib/billing-records.js";

let f;
beforeAll(async () => { f = await domainFixture(); });
afterAll(async () => { await f.cleanup(); });

async function task(user, snapshot) {
  return f.db.tryOn.create({ data: { userId: user.id, requestId: randomUUID(), personImage: "", clothesImage: "", prompt: "private prompt", snapshot } });
}

it("filters zero ledger entries before pagination and keeps the original audit rows", async () => {
  const user = await f.user(), other = await f.user();
  await f.db.creditTransaction.createMany({ data: [
    ...Array.from({ length: 64 }, (_, i) => ({ userId: user.id, channel: "credits", type: i % 2 ? "release" : "consume", amount: i % 2 ? 0 : -18, reason: "capture" })),
    { userId: other.id, type: "purchase", channel: "credits", amount: 999999 },
  ] });
  const first = await accountRecords(user.id, { tab: "usage", page: 1 }, f.db);
  const second = await accountRecords(user.id, { tab: "usage", page: 2 }, f.db);
  expect(first.transactions).toHaveLength(30);
  expect(first.pagination.usage.hasMore).toBe(true);
  expect(second.transactions).toHaveLength(2);
  expect(second.pagination.usage.hasMore).toBe(false);
  const all = [...first.transactions, ...second.transactions];
  expect(new Set(all.map(row => row.id)).size).toBe(32);
  expect(all.every(row => row.amount === -18)).toBe(true);
  expect(all.every(row => !("reason" in row) && !("tryOnId" in row))).toBe(true);
  expect(await f.db.creditTransaction.count({ where: { userId: user.id } })).toBe(64);
});

it("resolves specific tools and language operations without exposing task content or other users' tasks", async () => {
  const user = await f.user(), other = await f.user();
  const kinds = [
    [{ kind: "studio", tool: "generate", pricing: { resolution: "2K" } }, "生图"],
    [{ kind: "studio", tool: "inpaint" }, "局部修改"],
    [{ kind: "studio", tool: "expand" }, "AI 扩图"],
    [{ kind: "studio", tool: "ocr" }, "文字识别"],
    [{ kind: "studio", tool: "upscale" }, "AI 超清放大"],
    [{ kind: "language", purpose: "studio-optimize" }, "提示词优化"],
    [{ kind: "language", purpose: "commerce-agent" }, "电商套图规划"],
    [{ config: { workflowId: "single-shot" } }, "生图"],
  ];
  const expected = new Map();
  for (const [snapshot, label] of kinds) {
    const output = await task(user, snapshot);
    const row = await f.db.creditTransaction.create({ data: { userId: user.id, tryOnId: output.id, type: "consume", channel: "credits", amount: -18, reason: "capture" } });
    expected.set(row.id, label);
  }
  const foreignTask = await task(other, { kind: "studio", tool: "ocr" });
  const foreignLink = await f.db.creditTransaction.create({ data: { userId: user.id, tryOnId: foreignTask.id, type: "consume", channel: "credits", amount: -1 } });
  const result = await accountRecords(user.id, { tab: "usage" }, f.db);
  for (const row of result.transactions) {
    if (row.id === foreignLink.id) expect(row.operation).toBeNull();
    else expect(recordType(row, "zh")).toBe(expected.get(row.id));
    expect(recordDetail(row, "zh")).not.toMatch(/capture|private prompt/);
  }
  expect(result.transactions.find(row => row.resolution === "2K")).toBeDefined();
  expect(JSON.stringify(result)).not.toContain("private prompt");
});

it("shows actual credited balances from the ledger, handles refunds and never treats pending orders as credited", async () => {
  const user = await f.user(), other = await f.user();
  const rows = [];
  for (const [status, refundedMinor] of [["paid", 0], ["pending", 0], ["refunded", 4900], ["paid", 2450], ["failed", 0]]) {
    rows.push(await f.db.order.create({ data: { userId: user.id, type: "credits", planId: "deleted-pack", status, amountMinor: 4900, refundedMinor, currency: "cny", metadata: JSON.stringify({ credits: 99999 }) } }));
  }
  const [paid, pending, refunded, partial] = rows;
  for (const row of [paid, refunded, partial]) await f.db.creditTransaction.create({ data: { userId: user.id, type: "purchase", channel: "credits", amount: 3000, reason: row.id, businessKey: `purchase:${row.id}` } });
  for (const [row, amount] of [[refunded, -3000], [partial, -1500]]) await f.db.creditTransaction.create({ data: { userId: user.id, type: "payment_refund", channel: "credits", amount, reason: row.id } });
  // A foreign user's ledger row must not affect this user's order balance.
  await f.db.creditTransaction.create({ data: { userId: other.id, type: "purchase", channel: "credits", amount: 12345, reason: paid.id } });
  await f.db.order.create({ data: { userId: other.id, type: "credits", planId: "foreign", amountMinor: 999, status: "paid" } });
  const result = await accountRecords(user.id, { tab: "orders" }, f.db);
  expect(result.orders).toHaveLength(5);
  expect(result.orders.find(row => row.id === paid.id)).toMatchObject({ creditedCredits: 3000, amountMinor: 4900 });
  expect(result.orders.find(row => row.id === pending.id).creditedCredits).toBe(0);
  expect(result.orders.find(row => row.id === refunded.id).creditedCredits).toBe(0);
  expect(result.orders.find(row => row.id === partial.id).creditedCredits).toBe(1500);
  expect(result.orders.every(row => !("planId" in row) && !("metadata" in row))).toBe(true);
  expect(result.transactions).toEqual([]);
});

it("paginates credit purchases independently from usage and retired subscriptions", async () => {
  const user = await f.user();
  await f.db.order.createMany({ data: Array.from({ length: 22 }, (_, i) => ({ userId: user.id, type: i === 21 ? "subscription" : "credits", planId: "pack", amountMinor: 100, status: "pending" })) });
  const a = await accountRecords(user.id, { tab: "orders" }, f.db);
  const b = await accountRecords(user.id, { tab: "orders", page: 2 }, f.db);
  expect(a.orders).toHaveLength(20);
  expect(a.pagination.orders.hasMore).toBe(true);
  expect(b.orders).toHaveLength(1);
  expect(b.pagination.orders.hasMore).toBe(false);
  expect(new Set([...a.orders, ...b.orders].map(row => row.id)).size).toBe(21);
});
