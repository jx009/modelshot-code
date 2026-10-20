import { afterEach, expect, it, vi } from "vitest";
import { api } from "../../src/lib/client-api.js";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function pendingResponse(bodyOnly = false) {
  const fetcher = vi.fn((_url, { signal }) => {
    const wait = () => new Promise((_resolve, reject) => {
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    return bodyOnly ? Promise.resolve({ ok: true, json: wait }) : wait();
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

it.each([false, true])("times out stalled GET headers or body (%s) without retrying", async bodyOnly => {
  vi.useFakeTimers();
  const fetcher = pendingResponse(bodyOnly);
  const result = api("/api/inspiration").catch(error => error);
  await vi.advanceTimersByTimeAsync(15000);
  expect(await result).toMatchObject({ code: "REQUEST_TIMEOUT", retryable: true });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("preserves caller cancellation and clears its timer", async () => {
  vi.useFakeTimers(); pendingResponse();
  const controller = new AbortController();
  const result = api("/api/library", { signal: controller.signal }).catch(error => error);
  controller.abort();
  expect((await result).name).toBe("AbortError");
  expect(vi.getTimerCount()).toBe(0);
});

it("does not turn a pre-aborted caller into a timeout", async () => {
  vi.useFakeTimers(); pendingResponse();
  const controller = new AbortController();
  controller.abort();
  await expect(api("/api/library", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  expect(vi.getTimerCount()).toBe(0);
});

it.each([{ method: "POST" }, { method: "PUT" }, { timeoutMs: 0 }])("leaves writes and explicit long reads without a deadline (%j)", async options => {
  vi.useFakeTimers();
  const fetcher = pendingResponse();
  const controller = new AbortController();
  const result = api("/api/studio/documents", { ...options, signal: controller.signal }).catch(error => error);
  await vi.advanceTimersByTimeAsync(60000);
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  controller.abort();
  await result;
});

it("clears a completed read deadline and keeps HTTP error details", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ code: "UNAVAILABLE", traceId: "trace", retryable: true }) }));
  await expect(api("/api/library")).rejects.toMatchObject({ code: "UNAVAILABLE", status: 503, traceId: "trace", retryable: true });
  expect(vi.getTimerCount()).toBe(0);
});
