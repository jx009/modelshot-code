import { beforeEach, expect, it, vi } from "vitest";
import { GET, POST } from "../../src/app/api/creation/sessions/[id]/references/route.js";
import { AppError } from "../../src/lib/http.js";

const mock = vi.hoisted(() => ({ list: vi.fn(), upload: vi.fn() }));
vi.mock("../../src/lib/creation/require-user", () => ({ requireCreationUser: async () => ({ id: "user", creationEnv: process.env }) }));
vi.mock("../../src/lib/domain/identity/rate-limit", () => ({ rateLimit: vi.fn() }));
vi.mock("../../src/lib/domain/creation/reference-files", () => ({ listCreationReferences: (...args) => mock.list(...args), uploadCreationReference: (...args) => mock.upload(...args) }));
const context = { params: Promise.resolve({ id: "session" }) }, url = "https://example.test/api/creation/sessions/session/references";
const multipart = () => { const body = new FormData(); body.set("file", new File(["Brief"], "brief.md", { type: "text/markdown" })); return new Request(url, { method: "POST", body }); };
beforeEach(() => { mock.list.mockReset().mockResolvedValue([]); mock.upload.mockReset().mockResolvedValue({ id: "ref", name: "brief.md", fileType: "md", contentType: "text/markdown", bytes: 5, objectKey: "private", checksum: "secret" }); });

it("uses async session params and returns metadata without private storage fields", async () => {
  const list = await GET(new Request(url), context);
  expect(list.headers.get("cache-control")).toBe("private, no-store");
  expect(mock.list).toHaveBeenCalledWith("user", "session");
  const response = await POST(multipart(), context);
  expect(response.status).toBe(201);
  const body = await response.json();
  expect(body.item.id).toBe("ref");
  expect(body.item).not.toHaveProperty("objectKey"); expect(body.item).not.toHaveProperty("checksum");
  expect(mock.upload.mock.calls[0].slice(0, 2)).toEqual(["user", "session"]);
});

it("rejects cross-origin, oversized and malformed requests before upload", async () => {
  const cross = multipart(); cross.headers.set("sec-fetch-site", "cross-site");
  expect((await POST(cross, context)).status).toBe(403);
  const large = multipart(); large.headers.set("content-length", String(5 * 1024 * 1024));
  expect((await POST(large, context)).status).toBe(413);
  expect((await POST(new Request(url, { method: "POST", body: "bad", headers: { "content-type": "multipart/form-data; boundary=broken" } }), context)).status).toBe(400);
  expect((await POST(new Request(url, { method: "POST", body: "{}", headers: { "content-type": "application/json" } }), context)).status).toBe(415);
  expect(mock.upload).not.toHaveBeenCalled();
});

it("preserves ownership and quota error status codes", async () => {
  mock.list.mockRejectedValueOnce(new AppError("CREATION_SESSION_NOT_FOUND", 404));
  expect((await GET(new Request(url), context)).status).toBe(404);
  mock.upload.mockRejectedValueOnce(new AppError("CREATION_REFERENCE_COUNT_LIMIT", 413));
  expect((await POST(multipart(), context)).status).toBe(413);
});
