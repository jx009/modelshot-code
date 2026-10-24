import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { GET } from "../../src/app/api/creation/sessions/[id]/references/[referenceId]/route.js";
const ports = vi.hoisted(() => ({ find: vi.fn(), stream: vi.fn() }));
vi.mock("../../src/lib/require-user", () => ({ requireUser: async () => ({ id: "u" }) }));
vi.mock("../../src/lib/domain/identity/rate-limit", () => ({ rateLimit: vi.fn() }));
vi.mock("../../src/lib/prisma", () => ({ prisma: { creationReference: { findFirst: (...args) => ports.find(...args) } } }));
vi.mock("../../src/lib/infra/storage/s3", () => ({ objectStorage: () => ({ stream: (...args) => ports.stream(...args) }) }));
const source = Buffer.from("Retained original"), context = { params: Promise.resolve({ id: "s", referenceId: "r" }) };
beforeEach(() => {
  ports.find.mockReset().mockResolvedValue({ name: '原文件".md', fileType: "md", contentType: "text/markdown; charset=utf-8", bytes: source.length, checksum: createHash("sha256").update(source).digest("hex"), objectKey: "private/original" });
  ports.stream.mockReset().mockImplementation(async () => new ReadableStream({ start(controller) { controller.enqueue(source); controller.close(); } }));
});
it("serves an authenticated original as a private attachment with encoded filename", async () => {
  const response = await GET(new Request("https://example.test/download"), context);
  expect(response.status).toBe(200); expect(Buffer.from(await response.arrayBuffer())).toEqual(source);
  expect(response.headers.get("content-disposition")).toContain("attachment; filename=\"reference.md\"");
  expect(response.headers.get("content-disposition")).toContain("%22.md");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(ports.find.mock.calls[0][0].where).toEqual({ id: "r", userId: "u", sessionId: "s", deletedAt: null, session: { project: { userId: "u", deletedAt: null } } });
});
it("does not read foreign/deleted files or send an object with an invalid checksum", async () => {
  ports.find.mockResolvedValueOnce(null);
  expect((await GET(new Request("https://example.test/download"), context)).status).toBe(404); expect(ports.stream).not.toHaveBeenCalled();
  ports.stream.mockImplementationOnce(async () => new ReadableStream({ start(controller) { controller.enqueue(Buffer.from("wrong")); controller.close(); } }));
  const response = await GET(new Request("https://example.test/download"), context);
  expect(response.status).toBe(422); expect(await response.text()).not.toContain("private/original");
});
