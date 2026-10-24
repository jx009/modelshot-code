import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ db: {} }));
vi.mock("../../src/lib/prisma.js", () => ({ prisma: mocks.db }));
vi.mock("../../src/lib/infra/storage/s3.js", () => ({ objectStorage: () => ({}) }));
vi.mock("../../src/lib/domain/creation/web-artifacts.js", () => ({ ownedArtifact: vi.fn(async () => ({ kind: "web" })) }));
vi.mock("../../src/lib/domain/billing/ledger.js", () => ({ lockUser: vi.fn() }));

const { isConfiguredPublicationHost, publicationOrigin, publicWebHeaders, readPublishedWebResource } = await import("../../src/lib/domain/creation/web-publications.js");
const env = { CREATION_PUBLICATION_ORIGIN: "https://sites.example.test", NEXTAUTH_URL: "https://app.example.test" };
const document = () => ({ schemaVersion: 1, kind: "web", title: "Site", theme: { primary: "#112233", accent: "#ff5500", background: "#ffffff", fontFamily: "sans" }, entryPath: "index.html", viewport: { desktop: 1440, mobile: 390 }, assetIds: [], files: [{ id: "page-000000000001", path: "index.html", kind: "html", content: "<h1>Published</h1>" }] });

beforeEach(() => { mocks.db = {}; });

it("requires a separate configured HTTPS origin and validates the request host", () => {
  expect(publicationOrigin(env)).toBe("https://sites.example.test");
  expect(() => publicationOrigin({ ...env, CREATION_PUBLICATION_ORIGIN: "https://app.example.test" })).toThrow("CREATION_PUBLICATION_ORIGIN_MUST_BE_ISOLATED");
  expect(isConfiguredPublicationHost(new Request("https://sites.example.test/", { headers: { host: "sites.example.test" } }), env)).toBe(true);
  expect(isConfiguredPublicationHost(new Request("https://attacker.test/", { headers: { host: "attacker.test" } }), env)).toBe(false);
});

it("serves only the current public revision with sandbox and no-store headers", async () => {
  const bytes = Buffer.from(JSON.stringify(document())), checksum = createHash("sha256").update(bytes).digest("hex");
  const db = {
    webPublication: { findUnique: vi.fn(async () => ({ id: "publication", slug: "0123456789abcdef", userId: "user", artifactId: "artifact", status: "published", currentRevision: 2, artifact: { id: "artifact", kind: "web" } })) },
    webPublicationRevision: { findUnique: vi.fn(async () => ({ artifactRevision: { id: "artifact-revision", artifactId: "artifact", blob: { state: "ready", bytes: bytes.length, checksum, objectKey: "blob-key" } } })) },
  };
  const store = { get: vi.fn(async () => bytes) };
  const result = await readPublishedWebResource("0123456789abcdef", "", undefined, { db, store });
  expect(result.body).toBe("<h1>Published</h1>");
  expect(result.contentType).toBe("text/html; charset=utf-8");
  expect(publicWebHeaders(result.contentType).get("Content-Security-Policy")).toContain("sandbox allow-scripts");
  expect(publicWebHeaders(result.contentType).get("Cache-Control")).toBe("no-store");
  expect(db.webPublicationRevision.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { publicationId_revision: { publicationId: "publication", revision: 2 } } }));
  await expect(readPublishedWebResource("0123456789abcdef", "../secret", undefined, { db, store })).rejects.toThrow("WEB_PUBLIC_RESOURCE_NOT_FOUND");
});

it("does not expose a revoked site", async () => {
  const db = { webPublication: { findUnique: vi.fn(async () => ({ id: "publication", status: "revoked", currentRevision: 1, artifact: { kind: "web" } })) } };
  await expect(readPublishedWebResource("0123456789abcdef", "index.html", undefined, { db, store: { get: vi.fn() } })).rejects.toThrow("WEB_PUBLICATION_NOT_FOUND");
});

it("serves deleted-but-retained assets only through the published artifact revision reference", async () => {
  const id = "image-asset-000001", image = Buffer.from("image-bytes"), imageHash = createHash("sha256").update(image).digest("hex");
  const value = { ...document(), assetIds: [id], files: [...document().files, { id: "image-file-000001", path: "assets/photo.png", kind: "asset", assetId: id }] };
  const bytes = Buffer.from(JSON.stringify(value)), checksum = createHash("sha256").update(bytes).digest("hex");
  const db = {
    webPublication: { findUnique: vi.fn(async () => ({ id: "publication", slug: "0123456789abcdef", userId: "user", artifactId: "artifact", status: "published", currentRevision: 1, artifact: { id: "artifact", kind: "web" } })) },
    webPublicationRevision: { findUnique: vi.fn(async () => ({ artifactRevision: { id: "artifact-revision", artifactId: "artifact", blob: { state: "ready", bytes: bytes.length, checksum, objectKey: "blob-key" } } })) },
    asset: { findFirst: vi.fn(async args => { expect(args.where.status.in).toEqual(["active", "deleted"]); expect(args.where.references.some).toEqual({ entityId: "artifact-revision", kind: "creation_revision" }); return { objectKey: "asset-key", bytes: image.length, checksum: imageHash, contentType: "image/png" }; }) },
  };
  const result = await readPublishedWebResource("0123456789abcdef", "assets/photo.png", undefined, { db, store: { get: vi.fn(async key => key === "blob-key" ? bytes : image) } });
  expect(Buffer.from(result.body)).toEqual(image);
  expect(result.contentType).toBe("image/png");
});
