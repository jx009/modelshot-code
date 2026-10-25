import { beforeEach, expect, it, vi } from "vitest";
import { GET } from "../../src/app/api/studio/capabilities/route.js";

vi.mock("@/lib/creation/access", () => ({ getCreationEnv: async () => process.env }));
const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), capabilities: vi.fn() }));
vi.mock("@/lib/require-user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/domain/studio/providers", () => ({ capabilities: mocks.capabilities }));
vi.mock("@/lib/http", () => ({ errorResponse: error => Response.json({ code: error.message }, { status: error.status || 500 }) }));
beforeEach(() => {
  mocks.requireUser.mockReset().mockResolvedValue({ id: "user-a" });
  mocks.capabilities.mockReset().mockResolvedValue({ imageModels: [], tools: [] });
});

it("selects the image-only catalog and reports server stages without public caching", async () => {
  const response = await GET(new Request("https://app.test/api/studio/capabilities?scope=images&imageProvider=model-a"));
  expect(response.status).toBe(200);
  expect(mocks.capabilities).toHaveBeenCalledExactlyOnceWith(undefined, undefined, "model-a", { imageOnly: true });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("server-timing")).toMatch(/auth;dur=[\d.]+, catalogue;dur=[\d.]+, total;dur=[\d.]+/);
});

it("keeps the existing full capability endpoint for the canvas", async () => {
  await GET(new Request("https://app.test/api/studio/capabilities"));
  expect(mocks.capabilities).toHaveBeenCalledExactlyOnceWith(undefined, undefined, undefined, { imageOnly: false });
});

it("does not read configuration before authorization", async () => {
  mocks.requireUser.mockRejectedValue(Object.assign(new Error("UNAUTHORIZED"), { status: 401 }));
  const response = await GET(new Request("https://app.test/api/studio/capabilities?scope=images"));
  expect(response.status).toBe(401);
  expect(mocks.capabilities).not.toHaveBeenCalled();
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
