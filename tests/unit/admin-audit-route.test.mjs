import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), detail: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin: mocks.auth }));
vi.mock("@/lib/domain/identity/generation-audit", () => ({ generationAuditDetail: mocks.detail }));
import { GET } from "../../src/app/api/admin/tryons/[id]/route.js";

beforeEach(() => { mocks.detail.mockResolvedValue({ id: "job", prompt: "full prompt" }); });

it.each([401, 403])("denies unauthorized audit detail access (%s) before reading private inputs", async status => {
  mocks.auth.mockResolvedValue({ response: new Response("Denied", { status }) });
  const response = await GET(new Request("http://localhost/api/admin/tryons/job"), { params: Promise.resolve({ id: "job" }) });
  expect(response.status).toBe(status);
  expect(mocks.detail).not.toHaveBeenCalled();
});

it("returns private, non-cacheable details after administrator authorization", async () => {
  mocks.auth.mockResolvedValue({ user: { id: "admin", role: "admin" } });
  const response = await GET(new Request("http://localhost/api/admin/tryons/job"), { params: Promise.resolve({ id: "job" }) });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ id: "job", prompt: "full prompt" });
  expect(mocks.detail).toHaveBeenCalledWith("job", "admin");
});
