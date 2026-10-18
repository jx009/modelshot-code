import { afterEach, expect, it, vi } from "vitest";
import { IMAGE_REQUEST_TIMEOUT_MS } from "../../src/lib/ai/image-request.js";
import { imageClient } from "../../src/lib/domain/studio/providers.js";
import { executeOutput, safeProviderError } from "../../src/lib/domain/generation/execution.js";
const run = vi.hoisted(() => vi.fn());
vi.mock("../../src/lib/domain/studio/execution.js", () => ({ executeStudio: run }));
afterEach(() => vi.clearAllMocks());

it("dispatches the full image budget to studio instead of overriding it with 150 seconds", async () => {
  const db = { tryOn: { findUnique: vi.fn().mockResolvedValue({ snapshot: { kind: "studio", tool: "expand" } }) } };
  const store = {};
  await executeOutput("expand-job", { db, store });
  expect(run).toHaveBeenCalledWith("expand-job", { db, store, timeoutMs: 600_000 });
  expect(imageClient({ apiKey: "fixture" }, { imageRequest: true }).timeout).toBe(IMAGE_REQUEST_TIMEOUT_MS);
  expect(imageClient({ apiKey: "fixture" }).timeout).toBe(150_000);
  expect(imageClient({ apiKey: "fixture" }, { imageRequest: true }).maxRetries).toBe(0);
});

it("still honors an explicit caller deadline", async () => {
  const db = { tryOn: { findUnique: vi.fn().mockResolvedValue({ snapshot: { kind: "studio" } }) } };
  const store = {};
  await executeOutput("job", { db, store, timeoutMs: 50 });
  expect(run).toHaveBeenCalledWith("job", { db, store, timeoutMs: 50 });
});

it("keeps transport cause codes without exposing request internals", () => {
  const error = new TypeError("fetch failed", { cause: { code: "UND_ERR_HEADERS_TIMEOUT", request: { authorization: "secret" } } });
  expect(safeProviderError(error, "PROVIDER_RESULT_UNKNOWN")).toBe("PROVIDER_RESULT_UNKNOWN: UND_ERR_HEADERS_TIMEOUT: fetch failed");
});
