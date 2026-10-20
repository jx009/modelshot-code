// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import AdminDashboard from "../../src/app/[locale]/admin/page.js";

const stats = {
  totalUsers: 2, todayTryons: 1, totalTryons: 3, totalCostUsd: 0,
  needsReview: 0, providerDistribution: [], statusDistribution: [], trend: [], providerHealth: [],
};
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

test("a stalled dashboard request times out and can be retried without a page reload", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn()
    .mockImplementationOnce((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }))
    .mockResolvedValueOnce({ ok: true, json: async () => stats });
  vi.stubGlobal("fetch", fetcher);
  render(<AdminDashboard />);
  expect(screen.getByText("Loading...")).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
  expect(screen.getByRole("alert").textContent).toContain("加载超时，请重试。");
  expect(fetcher).toHaveBeenCalledOnce();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "重试" })); });
  expect(screen.getByRole("heading", { name: "数据看板" })).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test("leaving the dashboard aborts the in-flight request", async () => {
  const fetcher = vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
  vi.stubGlobal("fetch", fetcher);
  const view = render(<AdminDashboard />);
  const signal = fetcher.mock.calls[0][1].signal;
  expect(signal.aborted).toBe(false);
  view.unmount();
  await act(async () => {});
  expect(signal.aborted).toBe(true);
});

test("denied statistics produce an error rather than a cached administrative view", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: "Forbidden" }) })));
  render(<AdminDashboard />);
  expect((await screen.findByRole("alert")).textContent).toContain("加载失败，请重试。");
  expect(screen.queryByRole("heading", { name: "数据看板" })).toBeNull();
});
