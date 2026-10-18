import { afterEach, expect, it, vi } from "vitest";
import { submitDocument } from "../../src/lib/studio/save-document.js";

afterEach(() => vi.unstubAllGlobals());
const body = { id: "canvas", version: 1, saveKey: "same-request-key", content: { messages: [] } };
const saved = { ...body, version: 2 };
const options = () => ({ wait: vi.fn().mockResolvedValue(), onRetry: vi.fn() });

it("recovers from a proxy HTML 502 and reuses the exact save receipt", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response("<html>Bad gateway</html>", { status: 502 }))
    .mockResolvedValueOnce(Response.json(saved));
  vi.stubGlobal("fetch", fetch);
  const opts = options();
  expect(await submitDocument(body, opts)).toEqual(saved);
  expect(opts.onRetry).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
});

it("bounds outage retries and retains the actual HTTP status and trace ID", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ code: "INTERNAL_ERROR", traceId: "trace-503" }, { status: 503 })));
  await expect(submitDocument(body, options())).rejects.toMatchObject({ code: "DOCUMENT_SAVE_UNAVAILABLE", status: 503, traceId: "trace-503" });
  expect(fetch).toHaveBeenCalledTimes(3);
});

it.each([401, 409, 413, 422])("never retries a permanent HTTP %s failure", async status => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status })));
  await expect(submitDocument(body, options())).rejects.toMatchObject({ status });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("does not mark an empty successful proxy response as saved", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("")));
  await expect(submitDocument(body, options())).rejects.toMatchObject({ code: "DOCUMENT_SAVE_UNAVAILABLE" });
});

it("stops retries when the user changes project or session", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
  let active = true;
  await expect(submitDocument(body, { isCurrent: () => active, wait: async () => { active = false; } })).rejects.toThrow("SESSION_CLOSED");
  expect(fetch).toHaveBeenCalledTimes(1);
});
