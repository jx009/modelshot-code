import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";
import { objectStorage } from "../../infra/storage/s3.js";
import { lockUser } from "../billing/ledger.js";
import { digestJson } from "../generation/contracts.js";
import { cleanupExpiredCreationBlobs } from "./blob-maintenance.js";

export function createArtifactService({ documentSchema, operationsSchema, assetIds, applyOperations, OperationError, replacementSchema, validateReplacement = () => {}, validateOwnership = () => {}, invalidResultCode = "INVALID_ARTIFACT_RESULT", validateAgentOperations = () => {} }) {
  const MAX_BYTES = 2 * 1024 * 1024;
  const metadata = { id: true, projectId: true, name: true, kind: true, currentRevision: true, schemaVersion: true, createdAt: true, updatedAt: true };
  function validKey(key) { if (!/^[a-zA-Z0-9_-]{16,128}$/.test(key || "")) throw new AppError("SAVE_KEY_REQUIRED"); }

  async function ownedArtifact(userId, id, db = prisma) {
    const row = await db.creationArtifact.findFirst({ where: { id, deletedAt: null, project: { userId, deletedAt: null } }, select: metadata });
    if (!row) throw new AppError("ARTIFACT_NOT_FOUND", 404);
    return row;
  }
  async function ownedProject(userId, id, db) {
    const row = await db.creationProject.findFirst({ where: { id, userId, deletedAt: null }, select: { id: true } });
    if (!row) throw new AppError("CREATION_PROJECT_NOT_FOUND", 404);
    return row;
  }
  async function checkAssets(userId, document, db) {
    await validateOwnership(userId, document, db);
    const ids = assetIds(document);
    if (ids.length && await db.asset.count({ where: { id: { in: ids }, userId, status: "active", contentType: { in: ["image/png", "image/jpeg", "image/webp"] } } }) !== ids.length) throw new AppError("ASSET_NOT_FOUND", 404);
    return ids;
  }
  async function stage(userId, document, db, store) {
    const bytes = Buffer.from(JSON.stringify(document));
    if (bytes.length > MAX_BYTES) throw new AppError("ARTIFACT_TOO_LARGE", 413);
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const objectKey = `${userId}/creation/${randomUUID()}.json`;
    const blob = await db.creationBlob.create({ data: { userId, objectKey, checksum, bytes: bytes.length, expiresAt: new Date(Date.now() + 86400000) } });
    await store.put(objectKey, bytes, "application/json");
    return blob;
  }
  async function finalizeBlob(tx, blob) {
    const updated = await tx.creationBlob.updateMany({ where: { id: blob.id, state: "staging" }, data: { state: "ready" } });
    if (updated.count !== 1) throw new AppError("ARTIFACT_UPLOAD_EXPIRED", 409);
  }
  async function addReferences(tx, revision, ids) {
    if (ids.length) await tx.assetReference.createMany({ data: ids.map(assetId => ({ assetId, entityId: revision.id, kind: "creation_revision" })), skipDuplicates: true });
  }
  async function replay(tx, artifactId, saveKey, digest) {
    const previous = await tx.artifactRevision.findUnique({ where: { artifactId_saveKey: { artifactId, saveKey } } });
    if (!previous) return null;
    if (previous.inputDigest !== digest) throw new AppError("SAVE_KEY_REUSED", 409);
    return { artifactId, revision: previous.revision, baseRevision: previous.baseRevision, replayed: true };
  }

  async function createLayoutArtifact(userId, projectId, input, key, { db = prisma, store = objectStorage(), sourceRunId, hooks } = {}) {
    validKey(key);
    const document = documentSchema.parse(input), digest = digestJson({ document, sourceRunId: sourceRunId || null });
    await ownedProject(userId, projectId, db);
    const existing = await db.creationArtifact.findUnique({ where: { projectId_createKey: { projectId, createKey: key } } });
    if (existing) {
      if (existing.deletedAt) throw new AppError("ARTIFACT_NOT_FOUND", 404);
      return replay(db, existing.id, key, digest);
    }
    await hooks?.beforeStage?.();
    await checkAssets(userId, document, db);
    const blob = await stage(userId, document, db, store);
    return db.$transaction(async tx => {
      await lockUser(tx, userId);
      await ownedProject(userId, projectId, tx);
      const old = await tx.creationArtifact.findUnique({ where: { projectId_createKey: { projectId, createKey: key } } });
      if (old) {
        if (old.deletedAt) throw new AppError("ARTIFACT_NOT_FOUND", 404);
        return replay(tx, old.id, key, digest);
      }
      await hooks?.beforeCommit?.(tx);
      const ids = await checkAssets(userId, document, tx);
      await finalizeBlob(tx, blob);
      const artifact = await tx.creationArtifact.create({ data: { projectId, createKey: key, kind: document.kind, name: document.title, schemaVersion: document.schemaVersion } });
      const revision = await tx.artifactRevision.create({ data: { artifactId: artifact.id, revision: 1, baseRevision: 0, saveKey: key, inputDigest: digest, blobId: blob.id, source: sourceRunId ? "agent" : "manual", sourceRunId } });
      await addReferences(tx, revision, ids);
      await tx.creationProject.update({ where: { id: projectId }, data: { updatedAt: new Date(), ...(ids[0] ? { coverAssetId: ids[0] } : {}) } });
      const result = { artifactId: artifact.id, revision: 1, baseRevision: 0, replayed: false };
      // Server-only hooks let publication, step completion and the chat message
      // commit together. Object upload happened before acquiring these locks.
      await hooks?.afterCommit?.(tx, result);
      return result;
    }, { timeout: 15000 });
  }

  // Conflict recovery creates an independent artifact. It never writes over the
  // source, and remains available for existing work when new admissions are off.
  async function copyLayoutArtifact(userId, id, { content, saveKey }, { db = prisma, store = objectStorage() } = {}) {
    const source = await ownedArtifact(userId, id, db);
    const document = documentSchema.parse(content);
    if (document.kind !== source.kind) throw new AppError("ARTIFACT_KIND_MISMATCH", 422);
    const current = await readLayoutArtifact(userId, id, source.currentRevision, { db, store });
    validateReplacement(current.content, document);
    return createLayoutArtifact(userId, source.projectId, document, saveKey, { db, store });
  }

  async function readLayoutArtifact(userId, id, revision, { db = prisma, store = objectStorage() } = {}) {
    const artifact = await ownedArtifact(userId, id, db);
    const version = revision ?? artifact.currentRevision;
    if (!Number.isInteger(version) || version < 1) throw new AppError("INVALID_ARTIFACT_REVISION");
    const row = await db.artifactRevision.findUnique({ where: { artifactId_revision: { artifactId: id, revision: version } }, include: { blob: true } });
    if (!row || row.blob.userId !== userId || row.blob.state !== "ready") throw new AppError("ARTIFACT_REVISION_NOT_FOUND", 404);
    if (row.blob.bytes > MAX_BYTES) throw new AppError("ARTIFACT_TOO_LARGE", 413);
    const bytes = await store.get(row.blob.objectKey);
    if (bytes.length !== row.blob.bytes || createHash("sha256").update(bytes).digest("hex") !== row.blob.checksum) throw new AppError("ARTIFACT_INTEGRITY_FAILED", 502);
    let content;
    try { content = documentSchema.parse(JSON.parse(bytes.toString("utf8"))); }
    catch { throw new AppError("ARTIFACT_FORMAT_UNSUPPORTED", 422); }
    if (content.kind !== artifact.kind) throw new AppError("ARTIFACT_KIND_MISMATCH", 422);
    return { ...artifact, schemaVersion: content.schemaVersion, revision: row.revision, content };
  }

  async function commitRevision(userId, artifact, baseRevision, key, digest, document, { db, store, source, sourceRunId, hooks }) {
    const previous = await replay(db, artifact.id, key, digest);
    if (previous) return previous;
    await checkAssets(userId, document, db);
    const blob = await stage(userId, document, db, store);
    return db.$transaction(async tx => {
      await lockUser(tx, userId);
      await ownedArtifact(userId, artifact.id, tx);
      const old = await replay(tx, artifact.id, key, digest);
      if (old) return old;
      await hooks?.beforeCommit?.(tx);
      const ids = await checkAssets(userId, document, tx);
      const changed = await tx.creationArtifact.updateMany({ where: { id: artifact.id, currentRevision: baseRevision, deletedAt: null }, data: { currentRevision: { increment: 1 }, name: document.title, schemaVersion: document.schemaVersion } });
      if (!changed.count) throw new AppError("ARTIFACT_VERSION_CONFLICT", 409);
      await finalizeBlob(tx, blob);
      const next = await tx.artifactRevision.create({ data: { artifactId: artifact.id, revision: baseRevision + 1, baseRevision, saveKey: key, inputDigest: digest, blobId: blob.id, source, sourceRunId } });
      await addReferences(tx, next, ids);
      await tx.creationProject.update({ where: { id: artifact.projectId }, data: { updatedAt: new Date() } });
      const result = { artifactId: artifact.id, revision: next.revision, baseRevision, replayed: false };
      await hooks?.afterCommit?.(tx, result);
      return result;
    }, { timeout: 15000 });
  }

  async function modifyLayoutArtifact(userId, id, { baseRevision, saveKey, operations }, { db = prisma, store = objectStorage(), sourceRunId, hooks } = {}) {
    validKey(saveKey);
    if (!Number.isInteger(baseRevision) || baseRevision < 1) throw new AppError("INVALID_ARTIFACT_REVISION");
    const parsed = operationsSchema.parse(operations);
    if (sourceRunId) validateAgentOperations(parsed);
    const artifact = await ownedArtifact(userId, id, db);
    const digest = digestJson({ baseRevision, operations: parsed, sourceRunId: sourceRunId || null });
    const previous = await replay(db, id, saveKey, digest);
    if (previous) return previous;
    if (artifact.currentRevision !== baseRevision) throw new AppError("ARTIFACT_VERSION_CONFLICT", 409);
    const snapshot = await readLayoutArtifact(userId, id, baseRevision, { db, store });
    let content;
    try { content = documentSchema.parse(applyOperations(snapshot.content, parsed)); }
    catch (error) { if (error instanceof OperationError || error.name === "HtmlDocumentError") throw new AppError(error.code, 422); if (error.name === "ZodError") throw new AppError(invalidResultCode, 422); throw error; }
    validateReplacement(snapshot.content, content);
    return commitRevision(userId, artifact, baseRevision, saveKey, digest, content, { db, store, source: sourceRunId ? "agent" : "manual", sourceRunId, hooks });
  }

  async function restoreLayoutArtifact(userId, id, { baseRevision, restoreRevision, saveKey }, { db = prisma, store = objectStorage() } = {}) {
    validKey(saveKey);
    if (![baseRevision, restoreRevision].every(value => Number.isInteger(value) && value > 0)) throw new AppError("INVALID_ARTIFACT_REVISION");
    const artifact = await ownedArtifact(userId, id, db), digest = digestJson({ baseRevision, restoreRevision });
    const previous = await replay(db, id, saveKey, digest);
    if (previous) return previous;
    if (artifact.currentRevision !== baseRevision) throw new AppError("ARTIFACT_VERSION_CONFLICT", 409);
    const old = await readLayoutArtifact(userId, id, restoreRevision, { db, store });
    return commitRevision(userId, artifact, baseRevision, saveKey, digest, old.content, { db, store, source: "restore" });
  }

  // Native editor snapshots cannot fit in a 240 KiB semantic operation or be
  // decomposed into it without losing plugin data. Opt-in codecs use the same
  // immutable blobs, CAS and idempotency as operation saves. AI still has no
  // whole-document replacement permission through this path.
  async function replaceLayoutArtifact(userId, id, { baseRevision, saveKey, content }, { db = prisma, store = objectStorage(), sourceRunId } = {}) {
    if (!replacementSchema || sourceRunId) throw new AppError("ARTIFACT_REPLACEMENT_UNSUPPORTED", 422);
    validKey(saveKey);
    if (!Number.isInteger(baseRevision) || baseRevision < 1) throw new AppError("INVALID_ARTIFACT_REVISION");
    const document = replacementSchema.parse(content);
    const artifact = await ownedArtifact(userId, id, db);
    if (document.kind !== artifact.kind) throw new AppError("ARTIFACT_KIND_MISMATCH", 422);
    const digest = digestJson({ mode: "snapshot", baseRevision, document });
    const previous = await replay(db, id, saveKey, digest);
    if (previous) return previous;
    if (artifact.currentRevision !== baseRevision) throw new AppError("ARTIFACT_VERSION_CONFLICT", 409);
    const current = await readLayoutArtifact(userId, id, baseRevision, { db, store });
    validateReplacement(current.content, document);
    return commitRevision(userId, artifact, baseRevision, saveKey, digest, document, { db, store, source: "manual" });
  }

  async function listArtifactRevisions(userId, id, before, db = prisma) {
    await ownedArtifact(userId, id, db);
    if (before !== undefined && (!Number.isInteger(before) || before < 1)) throw new AppError("INVALID_CURSOR");
    const rows = await db.artifactRevision.findMany({ where: { artifactId: id, ...(before ? { revision: { lt: before } } : {}) },
      orderBy: { revision: "desc" }, take: 25,
      select: { revision: true, baseRevision: true, source: true, createdAt: true },
    });
    return { items: rows.slice(0, 24), nextCursor: rows.length > 24 ? rows[23].revision : null };
  }

  async function cleanupStagedBlobs({ db = prisma, store = objectStorage(), now = new Date(), ...options } = {}) {
    return (await cleanupExpiredCreationBlobs({ db, store, now, ...options })).scanned;
  }

  return { ownedArtifact, createLayoutArtifact, copyLayoutArtifact, readLayoutArtifact, modifyLayoutArtifact, replaceLayoutArtifact, restoreLayoutArtifact, listArtifactRevisions, cleanupStagedBlobs };
}
