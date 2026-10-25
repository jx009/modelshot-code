import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ db: {} }));
vi.mock("../../src/lib/prisma.js", () => ({ prisma: mocks.db }));
vi.mock("../../src/lib/infra/storage/s3.js", () => ({ objectStorage: () => ({}) }));
vi.mock("../../src/lib/domain/creation/web-artifacts.js", () => ({ ownedArtifact: vi.fn(async () => ({ kind: "web" })) }));
vi.mock("../../src/lib/domain/billing/ledger.js", () => ({ lockUser: vi.fn() }));

const { changeWebPublication, isConfiguredPublicationHost, publicationOrigin, publicWebHeaders, readPublishedWebResource } = await import("../../src/lib/domain/creation/web-publications.js");
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
  const redirect = await readPublishedWebResource("0123456789abcdef", "", undefined, { db, store });
  expect(redirect.redirect).toBe("/api/public-sites/0123456789abcdef/~v/2/index.html");
  const result = await readPublishedWebResource("0123456789abcdef", "index.html", 2, { db, store });
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
  const result = await readPublishedWebResource("0123456789abcdef", "assets/photo.png", 1, { db, store: { get: vi.fn(async key => key === "blob-key" ? bytes : image) } });
  expect(Buffer.from(result.body)).toEqual(image);
  expect(result.contentType).toBe("image/png");
});

it("revokes exactly the expected revision, replays safely and rejects stale commands", async () => {
  const row = { id: "publication", slug: "0123456789abcdef", status: "published", currentRevision: 2 };
  let command;
  const db = {
    $transaction: fn => fn(db),
    webPublication: {
      findUnique: vi.fn(async () => ({ ...row })),
      updateMany: vi.fn(async ({ where, data }) => {
        expect(where).toMatchObject({ status: "published", currentRevision: 2 });
        Object.assign(row, data); return { count: 1 };
      }),
    },
    webPublicationCommand: { findUnique: vi.fn(async () => command), create: vi.fn(async ({ data }) => { command = data; }) },
  };
  const options = { db, env, store: {} };
  await expect(changeWebPublication("user", "artifact", { action: "revoke", expectedRevision: 1, saveKey: "stale-key" }, options)).rejects.toThrow("WEB_PUBLICATION_CHANGED");
  const input = { action: "revoke", expectedRevision: 2, saveKey: "revoke-key" };
  expect((await changeWebPublication("user", "artifact", input, options)).status).toBe("revoked");
  expect((await changeWebPublication("user", "artifact", input, options)).status).toBe("revoked");
  expect(db.webPublication.updateMany).toHaveBeenCalledOnce();
  await expect(changeWebPublication("user", "artifact", { ...input, expectedRevision: 3 }, options)).rejects.toThrow("WEB_PUBLICATION_KEY_REUSED");
});

it("keeps nested entry and assets on the requested version after a later publish", async () => {
  const first = document(); first.entryPath = "pages/home.html"; first.files[0].path = first.entryPath;
  first.files[0].content = '<link rel="stylesheet" href="/styles/main.css"><a href="/pages/about.html">About</a>';
  first.files.push({ id: "css", kind: "css", path: "styles/main.css", content: "body{color:red}" }, { id: "about", kind: "html", path: "pages/about.html", content: "<p>About</p>" });
  const bytes = Buffer.from(JSON.stringify(first)), checksum = createHash("sha256").update(bytes).digest("hex");
  const db = {
    webPublication: { findUnique: vi.fn(async () => ({ id: "pub", artifactId: "a", status: "published", currentRevision: 3, artifact: { kind: "web" } })) },
    webPublicationRevision: { findUnique: vi.fn(async () => ({ artifactRevision: { artifactId: "a", blob: { state: "ready", bytes: bytes.length, checksum, objectKey: "v1" } } })) },
  };
  const options = { db, store: { get: vi.fn(async () => bytes) } };
  expect((await readPublishedWebResource("0123456789abcdef", "", 1, options)).redirect).toBe("/api/public-sites/0123456789abcdef/~v/1/pages/home.html");
  const page = await readPublishedWebResource("0123456789abcdef", "pages/home.html", 1, options);
  expect(page.body).toContain('href="../styles/main.css"');
  expect(page.body).toContain('href="about.html"');
  expect(db.webPublicationRevision.findUnique).toHaveBeenLastCalledWith(expect.objectContaining({ where: { publicationId_revision: { publicationId: "pub", revision: 1 } } }));
  await expect(readPublishedWebResource("0123456789abcdef", "pages/home.html", NaN, options)).rejects.toThrow("WEB_PUBLIC_RESOURCE_NOT_FOUND");
});

it("publishes two immutable versions, rejects broken replacement, rolls back and revokes all pinned URLs", async () => {
  const sources = new Map(), blobs = new Map(), versions = new Map(), commands = new Map();
  for (const revision of [1, 2, 3]) {
    const content = document();
    content.files[0].content = `<link rel="stylesheet" href="${revision === 3 ? "missing.css" : "/theme.css"}"><h1>Version ${revision}</h1>`;
    content.files.push({ id: "css", path: "theme.css", kind: "css", content: `body{color:${revision === 1 ? "red" : "blue"}}` });
    const bytes = Buffer.from(JSON.stringify(content)), objectKey = `source-${revision}`;
    sources.set(revision, { id: `artifact-revision-${revision}`, artifactId: "artifact", revision, blob: { state: "ready", bytes: bytes.length, checksum: createHash("sha256").update(bytes).digest("hex"), objectKey } });
    blobs.set(objectKey, bytes);
  }
  let publication = null;
  const presentRow = () => publication && { ...publication, artifact: { id: "artifact", kind: "web" }, revisions: [...versions.values()].reverse() };
  const pin = revision => {
    const row = versions.get(revision);
    return row ? { ...row, artifactRevision: sources.get(row.sourceRevision) } : null;
  };
  const db = {
    $transaction: fn => fn(db),
    artifactRevision: { findUnique: vi.fn(async ({ where }) => sources.get(where.artifactId_revision.revision)) },
    webPublication: {
      findUnique: vi.fn(async () => presentRow()),
      create: vi.fn(async ({ data }) => (publication = { ...data, id: "pub", currentRevision: null })),
      updateMany: vi.fn(async ({ where, data }) => {
        if (publication.currentRevision !== where.currentRevision || where.status && publication.status !== where.status) return { count: 0 };
        Object.assign(publication, data); return { count: 1 };
      }),
    },
    webPublicationRevision: {
      create: vi.fn(async ({ data }) => { if (versions.has(data.revision)) throw new Error("DUPLICATE_REVISION"); versions.set(data.revision, data); return data; }),
      findUnique: vi.fn(async ({ where }) => pin(where.publicationId_revision.revision)),
      findFirst: vi.fn(async ({ where }) => pin(where.revision)),
    },
    webPublicationCommand: {
      create: vi.fn(async ({ data }) => { commands.set(data.saveKey, data); return data; }),
      findUnique: vi.fn(async ({ where }) => commands.get(where.publicationId_saveKey.saveKey)),
    },
  };
  const options = { db, env, store: { get: vi.fn(async key => blobs.get(key)) } };
  const first = { action: "publish", expectedRevision: null, sourceRevision: 1, saveKey: "first-publication" };
  const published = await changeWebPublication("user", "artifact", first, options), slug = published.slug;
  expect(published.currentRevision).toBe(1);
  await changeWebPublication("user", "artifact", { ...first, expectedRevision: 1, sourceRevision: 2, saveKey: "second-publication" }, options);
  expect((await readPublishedWebResource(slug, "theme.css", 1, options)).body).toContain("red");
  expect((await readPublishedWebResource(slug, "theme.css", 2, options)).body).toContain("blue");
  await expect(changeWebPublication("user", "artifact", { ...first, expectedRevision: 2, sourceRevision: 3, saveKey: "broken-publication" }, options)).rejects.toThrow("WEB_REFERENCE_NOT_FOUND");
  expect(publication.currentRevision).toBe(2);
  await expect(changeWebPublication("user", "artifact", { ...first, sourceRevision: 2 }, options)).rejects.toThrow("WEB_PUBLICATION_KEY_REUSED");
  const rollback = { action: "rollback", expectedRevision: 2, targetRevision: 1, saveKey: "rollback-command" };
  expect((await changeWebPublication("user", "artifact", rollback, options)).currentRevision).toBe(3);
  expect((await readPublishedWebResource(slug, "theme.css", 3, options)).body).toContain("red");
  await changeWebPublication("user", "artifact", rollback, options);
  expect(versions.size).toBe(3);
  expect(sources.get(2).revision).toBe(2);
  await changeWebPublication("user", "artifact", { action: "revoke", expectedRevision: 3, saveKey: "revoke-command" }, options);
  for (const revision of [1, 2, 3]) await expect(readPublishedWebResource(slug, "theme.css", revision, options)).rejects.toThrow("WEB_PUBLICATION_NOT_FOUND");
});
