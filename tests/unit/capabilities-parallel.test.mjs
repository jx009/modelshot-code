import { afterEach, expect, it, vi } from "vitest";
import { capabilities } from "../../src/lib/domain/studio/providers.js";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

it("starts routing, prices and tool discovery before waiting for any of them", async () => {
  const routing = deferred(), pricing = deferred(), tools = deferred();
  const db = {
    modelProvider: { findMany: vi.fn(() => routing.promise) },
    studioToolConfig: { findMany: vi.fn(async () => []) },
    systemConfig: { findUnique: vi.fn(() => pricing.promise) },
  };
  const fetcher = vi.fn(() => tools.promise);
  vi.stubGlobal("fetch", fetcher);
  const pending = capabilities(db, { toolsURL: "https://tools.example", toolsKey: "test-key" });
  expect(db.modelProvider.findMany).toHaveBeenCalledTimes(1);
  expect(db.systemConfig.findUnique).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledWith("https://tools.example/capabilities", expect.objectContaining({ headers: { Authorization: "Bearer test-key" } }));
  routing.resolve([]);
  pricing.resolve(null);
  tools.resolve({ ok: true, json: async () => ({ tools: [] }) });
  const result = await pending;
  expect(result.imageModels).toEqual([]);
  expect(JSON.stringify(result)).not.toContain("test-key");
});

it("keeps model discovery available when the tool service fails", async () => {
  vi.stubEnv("STUDIO_TOOLS_URL", "https://tools.example");
  vi.stubEnv("STUDIO_TOOLS_KEY", "test-key");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("unavailable")));
  const db = {
    modelProvider: { findMany: async () => [] },
    studioToolConfig: { findMany: async () => [] },
    systemConfig: { findUnique: async () => null },
  };
  const result = await capabilities(db);
  expect(result.imageModels).toEqual([]);
  expect(result.tools.find(tool => tool.id === "remove-bg").available).toBe(false);
});
