import { expect, it, vi } from "vitest";
import { createThumbnailQueue } from "../../src/lib/creation/client/thumbnail-queue.js";

const result = (size = 4, missingImages = false) => ({ blob: new Blob([new Uint8Array(size)]), missingImages });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; }

it("runs one thumbnail at a time and removes cancelled queued pages before rendering", async () => {
  const first = deferred(), third = deferred(), secondSignal = new AbortController();
  const render = vi.fn(page => page.id === "one" ? first.promise : third.promise), queue = createThumbnailQueue(render);
  const one = queue.read({ id: "one" }), two = queue.read({ id: "two" }, secondSignal.signal), three = queue.read({ id: "three" });
  const cancelled = expect(two).rejects.toMatchObject({ name: "AbortError" });
  secondSignal.abort(); await cancelled;
  expect(render.mock.calls.map(([page]) => page.id)).toEqual(["one"]);
  first.resolve(result()); await one;
  expect(render.mock.calls.map(([page]) => page.id)).toEqual(["one", "three"]);
  third.resolve(result()); await three; queue.dispose();
});

it("bounds pending work and does not start queued work after the editor closes", async () => {
  const active = deferred(); let renderSignal;
  const render = vi.fn((_page, signal) => { renderSignal = signal; return active.promise; });
  const queue = createThumbnailQueue(render, { maxPending: 1 });
  const one = queue.read({}), two = queue.read({});
  await expect(queue.read({})).rejects.toThrow("THUMBNAIL_QUEUE_FULL");
  const closedOne = expect(one).rejects.toMatchObject({ name: "AbortError" }), closedTwo = expect(two).rejects.toMatchObject({ name: "AbortError" });
  queue.dispose(); await Promise.all([closedOne, closedTwo]);
  expect(renderSignal.aborted).toBe(true);
  active.resolve(result());
  await expect(queue.read({})).rejects.toMatchObject({ name: "AbortError" });
  expect(render).toHaveBeenCalledTimes(1);
});

it("reuses unchanged pages, rerenders changed pages, and bounds the cache by bytes with LRU eviction", async () => {
  const render = vi.fn(async () => result()), queue = createThumbnailQueue(render, { maxBytes: 8 });
  const a = { id: "a" }, b = { id: "b" }, c = { id: "c" };
  await queue.read(a); await queue.read(b); await queue.read(a);
  expect(render).toHaveBeenCalledTimes(2);
  await queue.read(c); // evicts b, because a was recently read
  await queue.read(a); expect(render).toHaveBeenCalledTimes(3);
  await queue.read(b); expect(render).toHaveBeenCalledTimes(4);
  await queue.read({ ...a, title: "Edited" }); expect(render).toHaveBeenCalledTimes(5);
  queue.dispose();
});

it("does not cache incomplete image previews or failed renders", async () => {
  const page = {}, render = vi.fn().mockRejectedValueOnce(new Error("image timeout")).mockResolvedValueOnce(result(4, true)).mockResolvedValue(result());
  const queue = createThumbnailQueue(render);
  await expect(queue.read(page)).rejects.toThrow("image timeout");
  await queue.read(page); await queue.read(page); await queue.read(page);
  expect(render).toHaveBeenCalledTimes(3); queue.dispose();
});
