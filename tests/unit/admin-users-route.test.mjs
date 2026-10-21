import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), users: vi.fn(), count: vi.fn(), usage: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findMany: mocks.users, count: mocks.count }, creditTransaction: { groupBy: mocks.usage } } }));
import { GET } from "../../src/app/api/admin/users/route.js";

beforeEach(() => {
  mocks.auth.mockResolvedValue({ user: { id: "admin", role: "admin" } });
  mocks.users.mockResolvedValue([{ id: "user", passwordHash: "never-expose", _count: { tryons: 7 } }]);
  mocks.count.mockResolvedValue(1);
  mocks.usage.mockResolvedValue([{ userId: "user", _sum: { amount: -12 } }]);
});

test("starts total count alongside the page and limits usage to visible users", async () => {
  let release;
  mocks.users.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const request = GET(new Request("http://localhost/api/admin/users?page=2"));
  await Promise.resolve();
  expect(mocks.count).toHaveBeenCalledOnce();
  expect(mocks.usage).not.toHaveBeenCalled();
  release([{ id: "user", passwordHash: "never-expose", _count: { tryons: 7 } }]);
  const response = await request;
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const data = await response.json();
  expect(data.users[0]).toMatchObject({ hasPassword: true, tryonCount: 7, monthUsage: 12 });
  expect(data.users[0]).not.toHaveProperty("passwordHash");
  expect(mocks.users).toHaveBeenCalledWith(expect.objectContaining({ take: 20, skip: 20 }));
  expect(mocks.usage).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: { in: ["user"] } }) }));
});

test("skips usage aggregation for an empty page", async () => {
  mocks.users.mockResolvedValueOnce([]);
  const response = await GET(new Request("http://localhost/api/admin/users"));
  expect(response.status).toBe(200);
  expect(mocks.usage).not.toHaveBeenCalled();
});

test("checks authorization before any list query", async () => {
  mocks.auth.mockResolvedValueOnce({ response: new Response("Denied", { status: 403 }) });
  expect((await GET(new Request("http://localhost/api/admin/users"))).status).toBe(403);
  expect(mocks.users).not.toHaveBeenCalled();
  expect(mocks.count).not.toHaveBeenCalled();
});
