import { randomUUID, createHash } from "node:crypto";
import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";
import { objectStorage } from "../../infra/storage/s3.js";
import { webSchema } from "../../creation/contracts/web.js";
import { ownedArtifact } from "./web-artifacts.js";
import { lockUser } from "../billing/ledger.js";

const SLUG = /^[a-f0-9]{16}$/;
const MAX_PUBLIC_ASSET_BYTES = 8 * 1024 * 1024;

function publicationOrigin(env = process.env) {
  const value = env.CREATION_PUBLICATION_ORIGIN;
  if (!value) throw new AppError("CREATION_PUBLICATION_ORIGIN_REQUIRED", 503);
  let url;
  try { url = new URL(value); } catch { throw new AppError("CREATION_PUBLICATION_ORIGIN_INVALID", 503); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash
    || url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) throw new AppError("CREATION_PUBLICATION_ORIGIN_INVALID", 503);
  const appUrl = env.NEXTAUTH_URL;
  if (appUrl) {
    try { if (new URL(appUrl).host === url.host) throw new AppError("CREATION_PUBLICATION_ORIGIN_MUST_BE_ISOLATED", 503); }
    catch (error) { if (error instanceof AppError) throw error; }
  }
  return url.origin;
}

function present(row, env = process.env) {
  let url = null;
  try { if (row.status === "published" && row.currentRevision) url = `${publicationOrigin(env)}/api/public-sites/${row.slug}/`; } catch {}
  return { id: row.id, slug: row.slug, status: row.status, currentRevision: row.currentRevision,
    url, createdAt: row.createdAt, updatedAt: row.updatedAt,
    revisions: row.revisions?.map(item => ({ revision: item.revision, sourceRevision: item.sourceRevision, createdAt: item.createdAt })) || [] };
}

async function readArtifactRevision(artifactId, revision, db, store) {
  const row = await db.artifactRevision.findUnique({ where: { artifactId_revision: { artifactId, revision } }, include: { blob: true } });
  if (!row || row.blob.state !== "ready" || row.blob.bytes > 2 * 1024 * 1024) throw new AppError("ARTIFACT_REVISION_NOT_FOUND", 404);
  const bytes = await store.get(row.blob.objectKey);
  if (bytes.length !== row.blob.bytes || createHash("sha256").update(bytes).digest("hex") !== row.blob.checksum) throw new AppError("ARTIFACT_INTEGRITY_FAILED", 502);
  let content;
  try { content = webSchema.parse(JSON.parse(bytes.toString("utf8"))); } catch { throw new AppError("ARTIFACT_FORMAT_UNSUPPORTED", 422); }
  return { row, content };
}

export async function getWebPublication(userId, artifactId, { db = prisma, env = process.env } = {}) {
  const artifact = await ownedArtifact(userId, artifactId, db);
  if (artifact.kind !== "web") throw new AppError("ARTIFACT_KIND_MISMATCH", 422);
  const row = await db.webPublication.findUnique({ where: { artifactId }, include: { revisions: { orderBy: { revision: "desc" }, take: 20 } } });
  return row ? present(row, env) : { id: null, slug: null, status: "unpublished", currentRevision: null, url: null, revisions: [] };
}

export async function changeWebPublication(userId, artifactId, input, { db = prisma, store = objectStorage(), env = process.env } = {}) {
  const artifact = await ownedArtifact(userId, artifactId, db);
  if (artifact.kind !== "web") throw new AppError("ARTIFACT_KIND_MISMATCH", 422);
  publicationOrigin(env);
  let sourceRevision, expectedRevision, source;
  if (input.action === "publish") {
    sourceRevision = input.sourceRevision; expectedRevision = input.expectedRevision;
    source = await readArtifactRevision(artifactId, sourceRevision, db, store);
  }
  if (input.action === "rollback") expectedRevision = input.expectedRevision;

  return db.$transaction(async tx => {
    await lockUser(tx, userId);
    let publication = await tx.webPublication.findUnique({ where: { artifactId }, include: { revisions: { orderBy: { revision: "desc" }, take: 20 } } });
    if (publication) {
      const replay = await tx.webPublicationCommand.findUnique({ where: { publicationId_saveKey: { publicationId: publication.id, saveKey: input.saveKey } } });
      if (replay) {
        if (replay.action !== input.action) throw new AppError("WEB_PUBLICATION_KEY_REUSED", 409);
        return present(publication, env);
      }
    }
    if (input.action === "revoke") {
      if (!publication || publication.status !== "published" || publication.currentRevision !== expectedRevision) throw new AppError("WEB_PUBLICATION_CHANGED", 409);
      const updated = await tx.webPublication.updateMany({ where: { id: publication.id, status: "published", currentRevision: expectedRevision }, data: { status: "revoked" } });
      if (updated.count !== 1) throw new AppError("WEB_PUBLICATION_CHANGED", 409);
      await tx.webPublicationCommand.create({ data: { publicationId: publication.id, saveKey: input.saveKey, action: input.action, resultRevision: expectedRevision } });
      return present(await tx.webPublication.findUnique({ where: { id: publication.id }, include: { revisions: { orderBy: { revision: "desc" }, take: 20 } } }), env);
    }
    if ((publication?.currentRevision ?? null) !== expectedRevision) throw new AppError("WEB_PUBLICATION_CHANGED", 409);

    let artifactRevisionId;
    if (input.action === "publish") {
      artifactRevisionId = source.row.id;
    } else {
      const target = await tx.webPublicationRevision.findFirst({ where: { publicationId: publication.id, revision: input.targetRevision }, include: { artifactRevision: { select: { id: true, artifactId: true, revision: true } } } });
      if (!target || target.artifactRevision.artifactId !== artifactId) throw new AppError("WEB_PUBLICATION_REVISION_NOT_FOUND", 404);
      artifactRevisionId = target.artifactRevision.id; sourceRevision = target.artifactRevision.revision;
    }

    if (!publication) {
      publication = await tx.webPublication.create({ data: { userId, artifactId, slug: randomUUID().replaceAll("-", "").slice(0, 16), status: "revoked" } });
    }
    const revision = (publication.currentRevision || 0) + 1;
    await tx.webPublicationRevision.create({ data: { publicationId: publication.id, revision, sourceRevision, artifactRevisionId } });
    const updated = await tx.webPublication.updateMany({ where: { id: publication.id, currentRevision: publication.currentRevision }, data: { currentRevision: revision, status: "published" } });
    if (updated.count !== 1) throw new AppError("WEB_PUBLICATION_CHANGED", 409);
    await tx.webPublicationCommand.create({ data: { publicationId: publication.id, saveKey: input.saveKey, action: input.action, resultRevision: revision } });
    return present(await tx.webPublication.findUnique({ where: { id: publication.id }, include: { revisions: { orderBy: { revision: "desc" }, take: 20 } } }), env);
  }, { maxWait: 10000, timeout: 10000 });
}

export async function readPublishedWebResource(slug, path, revision, { db = prisma, store = objectStorage() } = {}) {
  if (!SLUG.test(slug) || typeof path !== "string" || path.length > 240 || path && path.split("/").some(part => !part || part === "." || part === ".." || !/^[a-zA-Z0-9_.-]+$/.test(part))) throw new AppError("WEB_PUBLIC_RESOURCE_NOT_FOUND", 404);
  const publication = await db.webPublication.findUnique({ where: { slug }, include: { artifact: { select: { id: true, kind: true } } } });
  if (!publication || publication.status !== "published" || !publication.currentRevision || publication.artifact.kind !== "web") throw new AppError("WEB_PUBLICATION_NOT_FOUND", 404);
  const version = revision ?? publication.currentRevision;
  const pin = await db.webPublicationRevision.findUnique({ where: { publicationId_revision: { publicationId: publication.id, revision: version } }, include: { artifactRevision: { include: { blob: true } } } });
  if (!pin || pin.artifactRevision.artifactId !== publication.artifactId || pin.artifactRevision.blob.state !== "ready" || pin.artifactRevision.blob.bytes > 2 * 1024 * 1024) throw new AppError("WEB_PUBLICATION_REVISION_NOT_FOUND", 404);
  const source = pin.artifactRevision.blob, bytes = await store.get(source.objectKey);
  if (bytes.length !== source.bytes || createHash("sha256").update(bytes).digest("hex") !== source.checksum) throw new AppError("ARTIFACT_INTEGRITY_FAILED", 502);
  let content;
  try { content = webSchema.parse(JSON.parse(bytes.toString("utf8"))); } catch { throw new AppError("ARTIFACT_FORMAT_UNSUPPORTED", 422); }
  const file = content.files.find(item => item.path === (path || content.entryPath));
  if (!file) throw new AppError("WEB_PUBLIC_RESOURCE_NOT_FOUND", 404);
  if (file.kind === "asset") {
    const asset = await db.asset.findFirst({ where: { id: file.assetId, userId: publication.userId, status: { in: ["active", "deleted"] }, contentType: { in: ["image/png", "image/jpeg", "image/webp"] }, references: { some: { entityId: pin.artifactRevision.id, kind: "creation_revision" } } }, select: { objectKey: true, bytes: true, checksum: true, contentType: true } });
    if (!asset || asset.bytes > MAX_PUBLIC_ASSET_BYTES) throw new AppError("WEB_PUBLIC_RESOURCE_NOT_FOUND", 404);
    const image = await store.get(asset.objectKey);
    if (image.length !== asset.bytes || createHash("sha256").update(image).digest("hex") !== asset.checksum) throw new AppError("ARTIFACT_INTEGRITY_FAILED", 502);
    return { body: image, contentType: asset.contentType, revision: version };
  }
  const types = { html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8" };
  return { body: file.content, contentType: types[file.kind], revision: version };
}

export function publicWebHeaders(contentType) {
  const headers = new Headers({ "Content-Type": contentType, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
  if (contentType.startsWith("text/html")) headers.set("Content-Security-Policy", "sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; frame-src 'none'; object-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  headers.set("Cache-Control", "no-store");
  return headers;
}

export function isConfiguredPublicationHost(request, env = process.env) {
  try { return new URL(env.CREATION_PUBLICATION_ORIGIN).host.toLowerCase() === request.headers.get("host")?.toLowerCase(); }
  catch { return false; }
}

export { publicationOrigin };
