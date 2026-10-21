import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), userCount: vi.fn(), tryOnCount: vi.fn(), groupBy: vi.fn(), aggregate: vi.fn(), revenue: vi.fn(), trend: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  user: { count: mocks.userCount },
  tryOn: { count: mocks.tryOnCount, groupBy: mocks.groupBy, aggregate: mocks.aggregate },
  order: { aggregate: mocks.revenue },
  $queryRaw: mocks.trend,
} }));
import { GET } from "../../src/app/api/admin/stats/route.js";
import { invalidateAdminStatsCache } from "../../src/lib/server/admin-stats-cache.js";

beforeEach(() => {
  invalidateAdminStatsCache();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
  mocks.auth.mockResolvedValue({ user: { id: "admin", role: "admin" } });
  mocks.userCount.mockResolvedValue(2);
  mocks.tryOnCount.mockResolvedValue(3);
  mocks.aggregate.mockResolvedValue({ _count: { _all: 3 }, _sum: { costUsd: 1.25 } });
  mocks.revenue.mockResolvedValue({ _sum: { amountMinor: 1000, refundedMinor: 100 } });
  mocks.groupBy.mockResolvedValue([]);
  mocks.trend.mockResolvedValue([{ day: 0, success: 5, failed: 1 }, { day: 13, success: 2, failed: 3 }]);
});
afterEach(() => { vi.useRealTimers(); });

test.each([401, 403])("denies access before querying any dashboard data (%i)", async status => {
  mocks.auth.mockResolvedValue({ response: new Response("Denied", { status }) });
  expect((await GET(new Request("http://localhost/api/admin/stats"))).status).toBe(status);
  for (const query of [mocks.trend, mocks.userCount, mocks.tryOnCount, mocks.groupBy, mocks.aggregate, mocks.revenue]) expect(query).not.toHaveBeenCalled();
});

test("uses bounded daily aggregates, fills missing days, and keeps responses private", async () => {
  const response = await GET(new Request("http://localhost/api/admin/stats"));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const data = await response.json();
  expect(data.trend).toHaveLength(14);
  expect(data.trend[0]).toEqual({ date: "10/7", success: 5, failed: 1 });
  expect(data.trend[1]).toEqual({ date: "10/8", success: 0, failed: 0 });
  expect(data.trend[13]).toEqual({ date: "10/20", success: 2, failed: 3 });
  expect(data).toMatchObject({ todayRevenue: 9, totalCostUsd: 1.25, needsReview: 3 });
  expect(data).toMatchObject({ totalTryons: 3, todayTryons: 3 });
  expect(mocks.trend).toHaveBeenCalledOnce();
  const [sql, startEpoch, start, end] = mocks.trend.mock.calls[0];
  expect(sql.join("?")).toContain("GROUP BY 1");
  expect(sql.join("?")).toContain("COUNT(*) FILTER");
  expect(new Date(start).getTime()).toBe(startEpoch);
  expect(new Date(end).getTime() - startEpoch).toBe(14 * 86400000);
});

test("reuses a short-lived snapshot after rechecking admin access", async () => {
  await GET(new Request("http://localhost/api/admin/stats"));
  await GET(new Request("http://localhost/api/admin/stats"));
  expect(mocks.auth).toHaveBeenCalledTimes(2);
  expect(mocks.trend).toHaveBeenCalledOnce();
  expect(mocks.userCount).toHaveBeenCalledTimes(2);
});

test("coalesces concurrent requests and refreshes expired snapshots", async () => {
  let finish;
  mocks.trend.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const requests = Array.from({ length: 5 }, () => GET(new Request("http://localhost/api/admin/stats")));
  await Promise.resolve();
  expect(mocks.trend).toHaveBeenCalledOnce();
  finish([]);
  expect((await Promise.all(requests)).every(response => response.status === 200)).toBe(true);
  vi.advanceTimersByTime(30_001);
  await GET(new Request("http://localhost/api/admin/stats"));
  expect(mocks.trend).toHaveBeenCalledTimes(2);
});

test("does not serve a warm snapshot after authorization is revoked", async () => {
  await GET(new Request("http://localhost/api/admin/stats"));
  mocks.auth.mockResolvedValue({ response: new Response("Denied", { status: 403 }) });
  expect((await GET(new Request("http://localhost/api/admin/stats"))).status).toBe(403);
  expect(mocks.trend).toHaveBeenCalledOnce();
});

test("does not cache a failed refresh", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.trend.mockRejectedValueOnce(new Error("temporary failure"));
  expect((await GET(new Request("http://localhost/api/admin/stats"))).status).toBe(500);
  expect((await GET(new Request("http://localhost/api/admin/stats"))).status).toBe(200);
  expect(mocks.trend).toHaveBeenCalledTimes(2);
});

test("starts the review count without waiting for trend aggregation", async () => {
  let resolveTrend;
  mocks.trend.mockImplementationOnce(() => new Promise(resolve => { resolveTrend = resolve; }));
  const response = GET(new Request("http://localhost/api/admin/stats"));
  await Promise.resolve();
  expect(mocks.tryOnCount).toHaveBeenCalledWith({ where: { qaStatus: "needs_review", reviewDecision: null } });
  resolveTrend([]);
  expect((await response).status).toBe(200);
});

test("returns an error rather than zeroed statistics when aggregation fails", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.trend.mockRejectedValueOnce(new Error("database unavailable"));
  expect((await GET(new Request("http://localhost/api/admin/stats"))).status).toBe(500);
});
