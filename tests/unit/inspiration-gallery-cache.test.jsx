// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import InspirationGallery from "../../src/components/discover/InspirationGallery.jsx";
import { readGalleryCache, writeGalleryCache } from "../../src/lib/inspiration/client-cache.js";

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/client-api", () => ({ api: mocks.api }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/ui/NavigationLink", () => ({ default: ({ children, ...props }) => <a {...props}>{children}</a> }));
vi.mock("@/components/discover/InspirationCover", () => ({ default: ({ item }) => <span>{item.title}</span> }));

const cached = {
  layout: { mode: "masonry", columns: 4, gap: 16 },
  items: [{ id: "old", title: "上次的灵感", category: "poster", size: "1024x1536", cover: { type: "asset", assetId: "public-cover" } }],
};

beforeEach(() => {
  mocks.api.mockReset();
  localStorage.clear();
  sessionStorage.clear();
  writeGalleryCache(cached, Date.now() - 2 * 86400000);
});
afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); });

test("shows a two-day-old list during a slow refresh then replaces it with the response", async () => {
  let resolve;
  mocks.api.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  render(<InspirationGallery zh explore />);
  expect(await screen.findByText("上次的灵感")).toBeTruthy();
  expect(screen.queryByText("正在加载灵感作品…")).toBeNull();
  await waitFor(() => expect(mocks.api).toHaveBeenCalledOnce());
  const fresh = { ...cached, items: [{ ...cached.items[0], id: "new", title: "最新的灵感" }] };
  await act(async () => resolve(fresh));
  expect(screen.getByText("最新的灵感")).toBeTruthy();
  expect(screen.queryByText("上次的灵感")).toBeNull();
  expect(readGalleryCache()).toEqual(fresh);
});

test("keeps the old list visible when background refresh fails", async () => {
  mocks.api.mockRejectedValueOnce(new Error("network unavailable"));
  render(<InspirationGallery zh explore />);
  expect(await screen.findByText("刷新暂时失败，仍显示上次内容。")).toBeTruthy();
  expect(screen.getByText("上次的灵感")).toBeTruthy();
  expect(screen.queryByText("正在加载灵感作品…")).toBeNull();
  expect(readGalleryCache()).toEqual(cached);
});

test("removes cached cards when revalidation returns an empty gallery", async () => {
  let resolve;
  mocks.api.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  render(<InspirationGallery zh explore />);
  expect(await screen.findByText("上次的灵感")).toBeTruthy();
  await act(async () => resolve({ ...cached, items: [] }));
  expect(screen.queryByText("上次的灵感")).toBeNull();
  expect(readGalleryCache().items).toEqual([]);
});
