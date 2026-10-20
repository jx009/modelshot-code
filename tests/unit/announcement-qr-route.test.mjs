import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), audit: vi.fn(), list: vi.fn(), url: vi.fn(), upload: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin: mocks.auth, auditLog: mocks.audit }));
vi.mock("@/lib/server/announcements", () => ({ getAnnouncements: mocks.list }));
vi.mock("@/lib/server/announcement-qr", () => ({ announcementQrUrl: mocks.url, uploadAnnouncementQr: mocks.upload, QR_MAX_BYTES: 5 * 1024 * 1024 }));
vi.mock("@/lib/domain/identity/rate-limit", () => ({ rateLimit: mocks.limit }));
import { GET, POST } from "../../src/app/api/admin/announcements/qr/route.js";
import { GET as publicGet } from "../../src/app/api/announcements/qr/route.js";
const item = { id: "notice_001", enabled: true, priority: 1, buttonAction: "qr", qrImage: { id: "qr-id", target: "target" } };
beforeEach(() => { mocks.auth.mockResolvedValue({ user: { id: "admin" } }); mocks.list.mockResolvedValue({ items: [item] }); mocks.url.mockResolvedValue({ url: "https://cos.example/image.png?signature=temporary" }); });
it.each([401, 403])("requires administrator access to upload and preview drafts (%s)", async status => {
  mocks.auth.mockResolvedValue({ response: new Response("Denied", { status }) });
  expect((await GET(new Request("http://localhost/api/admin/announcements/qr"))).status).toBe(status);
  expect((await POST(new Request("http://localhost/api/admin/announcements/qr", { method: "POST" }))).status).toBe(status);
  expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.url).not.toHaveBeenCalled();
});
it("anonymous visitors only receive the selected live announcement's QR URL", async () => {
  const response = await publicGet(new Request("http://localhost/api/announcements/qr?id=notice_001"));
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(mocks.url).toHaveBeenCalledWith(item.qrImage);
  expect((await publicGet(new Request("http://localhost/api/announcements/qr?id=other"))).status).toBe(404);
  for (const changed of [{ enabled: false }, { endAt: "2020-01-01T00:00:00Z" }, { buttonAction: "link" }]) {
    mocks.list.mockResolvedValue({ items: [{ ...item, ...changed }] });
    expect((await publicGet(new Request("http://localhost/api/announcements/qr?id=notice_001"))).status).toBe(404);
  }
  expect(mocks.url).toHaveBeenCalledTimes(1);
});
it("uploads multipart image bytes and audits the COS reference", async () => {
  mocks.upload.mockResolvedValue({ qrImage: item.qrImage, region: "ap-guangzhou" });
  const body = new FormData(); body.append("file", new File(["image-bytes"], "qr.png", { type: "image/png" }));
  const response = await POST(new Request("http://localhost/api/admin/announcements/qr", { method: "POST", body }));
  expect(response.status).toBe(200); expect(mocks.upload).toHaveBeenCalledWith(Buffer.from("image-bytes"));
  expect(mocks.audit).toHaveBeenCalledWith("admin", "UPLOAD_ANNOUNCEMENT_QR", null, { qrImage: item.qrImage, region: "ap-guangzhou" });
});
