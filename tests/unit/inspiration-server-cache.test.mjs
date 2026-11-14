import { beforeEach, expect, test, vi } from "vitest";

vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/server/inspiration", () => ({ publicInspirationGallery: vi.fn() }));
vi.mock("@/lib/server/inspiration-delivery", () => ({ inspirationDelivery: vi.fn(), enqueueInspirationGallery: vi.fn() }));

const { cachedPublicGallery, invalidatePublicGallery } = await import("@/lib/server/inspiration-cache");

beforeEach(() => invalidatePublicGallery());

test("concurrent requests share one load", async () => {
  const load = vi.fn(async () => ({ items: [1] }));
  const [a, b] = await Promise.all([cachedPublicGallery(load), cachedPublicGallery(load)]);
  expect(load).toHaveBeenCalledTimes(1);
  expect(a).toBe(b);
});

test("serves cached value within the TTL and reloads after it", async () => {
  const load = vi.fn(async () => ({ items: [] }));
  const start = Date.now();
  await cachedPublicGallery(load, start);
  await cachedPublicGallery(load, start + 30_000);
  expect(load).toHaveBeenCalledTimes(1);
  await cachedPublicGallery(load, start + 120_000);
  expect(load).toHaveBeenCalledTimes(2);
});

test("pending delivery uses a shorter TTL", async () => {
  const load = vi.fn(async () => ({ items: [], deliveryPending: true }));
  const start = Date.now();
  await cachedPublicGallery(load, start);
  await cachedPublicGallery(load, start + 30_000);
  expect(load).toHaveBeenCalledTimes(2);
});

test("invalidate forces a reload", async () => {
  const load = vi.fn(async () => ({ items: [] }));
  await cachedPublicGallery(load);
  invalidatePublicGallery();
  await cachedPublicGallery(load);
  expect(load).toHaveBeenCalledTimes(2);
});

test("a failed load is not cached", async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error("db down")).mockResolvedValueOnce({ items: [] });
  await expect(cachedPublicGallery(load)).rejects.toThrow("db down");
  await expect(cachedPublicGallery(load)).resolves.toEqual({ items: [] });
});
