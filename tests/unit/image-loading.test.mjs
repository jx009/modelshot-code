import { afterEach, beforeEach, expect, it, vi } from "vitest";

let loadImage, started;
const controllers = [];
const controller = () => { const value = new AbortController(); controllers.push(value); return value; };
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
beforeEach(async () => {
  vi.resetModules(); started = [];
  vi.stubGlobal("window", { Image: class {
    naturalWidth = 100;
    decode() { return Promise.resolve(); }
    set src(value) { this.url = value; if (value) started.push(this); }
  } });
  ({ loadImage } = await import("../../src/lib/studio/image-processor.js"));
});
afterEach(async () => {
  controllers.splice(0).forEach(c => c.abort()); await flush();
  vi.unstubAllGlobals(); vi.useRealTimers();
});

it("releases all old download slots when leaving a canvas, so reopening starts immediately", async () => {
  const old = controller(), next = controller();
  const tasks = Array.from({ length: 4 }, (_, i) => loadImage(`old-${i}`, { signal: old.signal }).catch(e => e.name));
  await flush(); expect(started).toHaveLength(4);
  old.abort();
  for (let i = 0; i < 4; i++) loadImage(`new-${i}`, { signal: next.signal }).catch(() => {});
  await flush();
  expect(started.slice(0, 4).every(image => image.url === "")).toBe(true);
  expect(started.slice(4).map(image => image.url)).toEqual(["new-0", "new-1", "new-2", "new-3"]);
  expect(await Promise.all(tasks)).toEqual(Array(4).fill("AbortError"));
});

it("keeps a shared download alive for another consumer and reuses a completed decode", async () => {
  const a = controller(), b = controller();
  const first = loadImage("shared", { signal: a.signal }).catch(e => e.name);
  const second = loadImage("shared", { signal: b.signal });
  await flush(); a.abort();
  expect(started).toHaveLength(1); expect(started[0].url).toBe("shared");
  await started[0].onload();
  expect(await first).toBe("AbortError");
  expect(await second).toBe(started[0]);
  expect(await loadImage("shared")).toBe(started[0]);
  expect(started).toHaveLength(1);
});

it("removes abandoned queued work before it starts downloading", async () => {
  const active = controller(), waiting = controller();
  for (let i = 0; i < 4; i++) loadImage(`active-${i}`, { signal: active.signal }).catch(() => {});
  const abandoned = loadImage("abandoned", { signal: waiting.signal }).catch(e => e.name);
  await flush(); waiting.abort(); active.abort(); await flush();
  expect(await abandoned).toBe("AbortError");
  expect(started).toHaveLength(4);
});

it("can reopen the same URL after cancellation without reusing the failed request", async () => {
  const old = controller(), next = controller();
  loadImage("same", { signal: old.signal }).catch(() => {});
  await flush(); old.abort();
  const current = loadImage("same", { signal: next.signal });
  await flush();
  expect(started).toHaveLength(2);
  await started[1].onload(); expect(await current).toBe(started[1]);
});

it("cancels the timeout retry without leaving the replacement request running", async () => {
  vi.useFakeTimers();
  const owner = controller();
  const pending = loadImage("timeout", { signal: owner.signal, timeoutMs: 100 }).catch(e => e.name);
  await flush(); await vi.advanceTimersByTimeAsync(100);
  expect(started).toHaveLength(2);
  owner.abort(); await flush();
  expect(await pending).toBe("AbortError");
  expect(started.every(image => image.url === "")).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
