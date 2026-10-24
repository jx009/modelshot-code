import { beforeEach, expect, test, vi } from "vitest";
import { invalidateProjectLists, peekProjectList, readProjectList } from "../../src/lib/studio/project-list.js";
import { projectHref, projectIdentity } from "../../src/lib/creation/project-links.js";

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/client-api", () => ({ api: mocks.api }));
const page = { items: [{ id: "project-a" }], nextCursor: null };
beforeEach(() => {
  mocks.api.mockReset();
  invalidateProjectLists("list-user-a");
  invalidateProjectLists("list-user-b");
});

test("equivalent first-page queries share a request and a fresh snapshot", async () => {
  let complete;
  mocks.api.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const first = readProjectList("list-user-a", "paged=1&q=&kind=all");
  const second = readProjectList("list-user-a");
  expect(mocks.api).toHaveBeenCalledTimes(1);
  complete(page);
  expect(await first).toEqual(page);
  expect(await second).toEqual(page);
  expect(await readProjectList("list-user-a")).toEqual(page);
  expect(mocks.api).toHaveBeenCalledTimes(1);
});

test("one departing consumer does not cancel another consumer's request", async () => {
  let complete, signal;
  mocks.api.mockImplementation((_url, options) => {
    signal = options.signal;
    return new Promise(resolve => { complete = resolve; });
  });
  const controller = new AbortController();
  const first = readProjectList("list-user-a", "paged=1", { signal: controller.signal });
  const second = readProjectList("list-user-a");
  const cancelled = expect(first).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await cancelled;
  expect(signal.aborted).toBe(false);
  complete(page);
  expect(await second).toEqual(page);
});

test("last consumer leaving aborts the request and allows a fresh retry", async () => {
  let signal;
  mocks.api.mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
    signal = options.signal;
    signal.addEventListener("abort", () => reject(signal.reason));
  })).mockResolvedValueOnce(page);
  const controller = new AbortController();
  const pending = readProjectList("list-user-a", "paged=1", { signal: controller.signal });
  const cancelled = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await cancelled;
  expect(signal.aborted).toBe(true);
  expect(await readProjectList("list-user-a")).toEqual(page);
});

test("invalidated in-flight reads cannot repopulate the snapshot", async () => {
  let complete;
  mocks.api.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; })).mockResolvedValueOnce({ items: [], nextCursor: null });
  const old = readProjectList("list-user-a");
  invalidateProjectLists("list-user-a");
  await readProjectList("list-user-a");
  complete(page);
  await old;
  expect(peekProjectList("list-user-a").items).toEqual([]);
});

test("different accounts never share reads or snapshots", async () => {
  mocks.api.mockResolvedValueOnce(page).mockResolvedValueOnce({ items: [], nextCursor: null });
  await readProjectList("list-user-a");
  expect(peekProjectList("list-user-b")).toBeNull();
  expect((await readProjectList("list-user-b")).items).toEqual([]);
  expect(mocks.api).toHaveBeenCalledTimes(2);
});

test("unified readers coalesce without sharing the canvas-only response, and invalidation clears both", async () => {
  const resolve = new Map();
  mocks.api.mockImplementation(url => new Promise(done => resolve.set(url.split("?")[0], done)));
  const canvas = readProjectList("list-user-a");
  const unified = readProjectList("list-user-a", "scope=creation");
  const sameUnified = readProjectList("list-user-a", "paged=1&kind=all&q=&scope=creation");
  expect(mocks.api).toHaveBeenCalledTimes(2);
  expect(peekProjectList("list-user-b", "scope=creation")).toBeNull();
  const mixedPage = { items: [{ id: "project-a", source: "studio" }, { id: "project-a", source: "creation" }], nextCursor: null };
  resolve.get("/api/studio/documents")(page);
  resolve.get("/api/creation/project-library")(mixedPage);
  expect(await canvas).toEqual(page);
  expect(await unified).toEqual(mixedPage);
  expect(await sameUnified).toEqual(mixedPage);
  expect(peekProjectList("list-user-a")).toEqual(page);
  expect(peekProjectList("list-user-a", "scope=creation")).toEqual(mixedPage);
  invalidateProjectLists("list-user-a");
  expect(peekProjectList("list-user-a")).toBeNull();
  expect(peekProjectList("list-user-a", "scope=creation")).toBeNull();
});

test("same-ID studio and creation projects have distinct UI identity and destinations", () => {
  const old = { id: "shared-id", kind: "canvas" }, creation = { id: "shared-id", kind: "poster", source: "creation" };
  expect(projectIdentity(old)).not.toBe(projectIdentity(creation));
  expect(projectIdentity(old)).toBe(projectIdentity({ ...old, source: "studio" }));
  expect(projectHref(old)).toBe("/studio-v2?document=shared-id");
  expect(projectHref(creation)).toBe("/creation?project=shared-id");
});
