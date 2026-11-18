import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), asset: vi.fn(), audit: vi.fn(), delivery: vi.fn(), get: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: { asset: { findUnique: mocks.asset }, adminAuditLog: { create: mocks.audit } } }));
vi.mock("@/lib/domain/assets/cos-delivery", () => ({ assetDeliveryUrl: mocks.delivery }));
vi.mock("@/lib/infra/storage/s3", () => ({ objectStorage: () => ({ get: mocks.get }) }));
import { GET } from "../../src/app/api/admin/assets/[id]/route.js";

const asset = { id: "image", userId: "owner", status: "active", contentType: "image/png", objectKey: "letaidraw/originals/owner/image.png" };
const context = { params: Promise.resolve({ id: asset.id }) };
beforeEach(() => {
  mocks.auth.mockResolvedValue({ user: { id: "admin" } });
  mocks.asset.mockResolvedValue(asset);
  mocks.delivery.mockResolvedValue(`https://ai-cdn.iamshuaidi.com/${asset.objectKey}`);
  mocks.get.mockResolvedValue(Buffer.from("image"));
});

test("authorizes and audits before redirecting administrator previews to CDN", async () => {
  const response = await GET(new Request("https://example.test/api/admin/assets/image"), context);
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe(`https://ai-cdn.iamshuaidi.com/${asset.objectKey}`);
  expect(mocks.audit).toHaveBeenCalledOnce();
  expect(mocks.get).not.toHaveBeenCalled();
});

test("does not return CDN links to an unauthorized visitor", async () => {
  mocks.auth.mockResolvedValueOnce({ response: new Response("Denied", { status: 403 }) });
  const response = await GET(new Request("https://example.test/api/admin/assets/image"), context);
  expect(response.status).toBe(403);
  expect(mocks.delivery).not.toHaveBeenCalled();
  expect(mocks.get).not.toHaveBeenCalled();
});

test("retains explicit source proxy access", async () => {
  const response = await GET(new Request("https://example.test/api/admin/assets/image?delivery=proxy"), context);
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("image");
  expect(mocks.delivery).not.toHaveBeenCalled();
});
