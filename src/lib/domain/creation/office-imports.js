import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../../prisma.js";
import { objectStorage } from "../../infra/storage/s3.js";
import { AppError } from "../../http.js";
import { lockUser } from "../billing/ledger.js";
import { importOfficeInProcess } from "./office-process.js";
import { createNativeOfficeArtifact } from "./native-office-artifacts.js";
import { createLayoutArtifact } from "./artifacts.js";
import { officeImportMetadata } from "../../creation/office/identity.js";

export const OFFICE_IMPORT_VERSION = "office-import-2";
export const OFFICE_IMPORT_BYTES = 4 * 1024 * 1024;
const active = ["queued", "running"], kinds = { docx: "document", xlsx: "sheet", pptx: "slides" };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
export function presentOfficeImport(row) {
  return { id: row.id, name: row.name, format: row.format, status: row.status, attempt: row.attempt,
    artifactId: row.artifactId, errorCode: row.errorCode, warnings: row.report?.warnings || [],
    createdAt: row.createdAt, updatedAt: row.updatedAt, sourceUrl: "/api/creation/imports/" + row.id + "/source" };
}
async function project(userId, id, db) {
  const row = await db.creationProject.findFirst({ where: { id, userId, deletedAt: null }, select: { id: true, kind: true } });
  if (!row) throw new AppError("CREATION_PROJECT_NOT_FOUND", 404);
  return row;
}
export async function ownedOfficeImport(userId, id, db = prisma) {
  const row = await db.creationImport.findFirst({ where: { id, userId, project: { deletedAt: null, userId } }, include: { sourceBlob: true } });
  if (!row) throw new AppError("OFFICE_IMPORT_NOT_FOUND", 404);
  return row;
}
export async function officeImportAvailable(db = prisma, env = process.env, now = new Date(), kind = null) {
  if (env.CREATION_OFFICE_IMPORT_ENABLED !== "true" || (kind !== "slides" && env.CREATION_NATIVE_OFFICE_ENABLED !== "true")) return false;
  const heartbeat = await db.serviceHeartbeat.findUnique({ where: { id: "creation-export-worker" } });
  return Boolean(heartbeat?.updatedAt > new Date(+now - 90000) && heartbeat.details?.importer === OFFICE_IMPORT_VERSION);
}
export async function enqueueOfficeImport(tx, row, now = new Date()) {
  const key = "creation-import:" + row.id + ":" + row.attempt + ":" + Math.floor(+now / 30000);
  await tx.outboxEvent.upsert({ where: { businessKey: key }, update: {}, create: { businessKey: key, kind: "creation-import", entityId: row.id } });
}
export async function listOfficeImports(userId, projectId, { db = prisma, env = process.env } = {}) {
  const owner = await project(userId, projectId, db);
  const rows = await db.creationImport.findMany({ where: { projectId, userId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 12 });
  return { items: rows.map(presentOfficeImport), enabled: await officeImportAvailable(db, env, new Date(), owner.kind) };
}
export async function requestOfficeImport(userId, projectId, file, importKey, { db = prisma, store = objectStorage(), env = process.env, now = new Date() } = {}) {
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(importKey || "")) throw new AppError("SAVE_KEY_REQUIRED", 400);
  const format = file.name?.split(".").at(-1)?.toLowerCase();
  if (!kinds[format]) throw new AppError("OFFICE_FORMAT_UNSUPPORTED", 415);
  if (!Number.isSafeInteger(file.size) || file.size < 22 || file.size > OFFICE_IMPORT_BYTES) throw new AppError("OFFICE_SOURCE_LIMIT", 413);
  const p = await project(userId, projectId, db);
  if (p.kind !== kinds[format]) throw new AppError("ARTIFACT_KIND_MISMATCH", 422);
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length !== file.size || bytes.readUInt32LE(0) !== 0x04034b50) throw new AppError("OFFICE_SOURCE_INVALID", 422);
  const checksum = hash(bytes), name = file.name.replace(/[\\/\x00-\x1f]/g, "_").slice(0, 160);
  const prior = await db.creationImport.findUnique({ where: { projectId_importKey: { projectId, importKey } }, include: { sourceBlob: true } });
  if (prior) {
    if (prior.sourceBlob.checksum !== checksum || prior.format !== format) throw new AppError("SAVE_KEY_REUSED", 409);
    return presentOfficeImport(prior);
  }
  if (!await officeImportAvailable(db, env, now, p.kind)) throw new AppError("OFFICE_WORKER_UNAVAILABLE", 503);
  const id = randomUUID();
  const blob = await db.creationBlob.create({ data: { userId, objectKey: userId + "/creation-imports/" + id + "/original." + format,
    bytes: bytes.length, checksum, expiresAt: new Date(+now + 86400000) } });
  await store.put(blob.objectKey, bytes, "application/octet-stream");
  return db.$transaction(async tx => {
    await lockUser(tx, userId); await project(userId, projectId, tx);
    const old = await tx.creationImport.findUnique({ where: { projectId_importKey: { projectId, importKey } }, include: { sourceBlob: true } });
    if (old) {
      if (old.sourceBlob.checksum !== checksum || old.format !== format) throw new AppError("SAVE_KEY_REUSED", 409);
      return presentOfficeImport(old);
    }
    await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended('creation-export-admission', 0))::text");
    const all = await tx.creationImport.count({ where: { status: { in: active } } }) + await tx.artifactExport.count({ where: { status: { in: active } } });
    const user = await tx.creationImport.count({ where: { userId, status: { in: active } } }) + await tx.artifactExport.count({ where: { userId, status: { in: active } } });
    if (all >= 50) throw new AppError("EXPORT_QUEUE_FULL", 503);
    if (user >= 2) throw new AppError("EXPORT_USER_QUEUE_FULL", 429);
    if (!await officeImportAvailable(tx, env, now, p.kind)) throw new AppError("OFFICE_WORKER_UNAVAILABLE", 503);
    const ready = await tx.creationBlob.updateMany({ where: { id: blob.id, state: "staging" }, data: { state: "ready" } });
    if (!ready.count) throw new AppError("OFFICE_UPLOAD_EXPIRED", 409);
    const row = await tx.creationImport.create({ data: { id, userId, projectId, importKey, name, format, sourceBlobId: blob.id, deadlineAt: new Date(+now + 15 * 60000), nextCheckAt: now } });
    await enqueueOfficeImport(tx, row, now);
    return presentOfficeImport(row);
  });
}
export async function cancelOfficeImport(userId, id, db = prisma) {
  return db.$transaction(async tx => {
    await lockUser(tx, userId); await ownedOfficeImport(userId, id, tx);
    await tx.creationImport.updateMany({ where: { id, status: { in: active } }, data: { status: "cancelled", leaseUntil: null, errorCode: null } });
    return presentOfficeImport(await ownedOfficeImport(userId, id, tx));
  });
}
export async function executeOfficeImport(id, { db = prisma, store = objectStorage(), parse = importOfficeInProcess, signal } = {}) {
  const source = await db.creationImport.findUnique({ where: { id } });
  if (!source || !active.includes(source.status)) return;
  const row = await db.$transaction(async tx => {
    await lockUser(tx, source.userId);
    const row = await tx.creationImport.findUnique({ where: { id }, include: { sourceBlob: true, project: true } }), now = new Date();
    if (!row || !active.includes(row.status) || row.status === "running" && row.leaseUntil > now || row.status === "queued" && row.nextCheckAt > now) return null;
    if (row.deadlineAt <= now || row.attempt >= 3 || row.project.deletedAt) {
      await tx.creationImport.update({ where: { id }, data: { status: "failed", errorCode: "OFFICE_IMPORT_EXPIRED", leaseUntil: null } }); return null;
    }
    return tx.creationImport.update({ where: { id }, data: { status: "running", attempt: { increment: 1 }, errorCode: null, leaseUntil: new Date(+now + 120000), nextCheckAt: new Date(+now + 120000) }, include: { sourceBlob: true } });
  });
  if (!row) return;
  const abort = new AbortController(), bounded = AbortSignal.any([abort.signal, AbortSignal.timeout(100000), ...(signal ? [signal] : [])]);
  let checking = false;
  const timer = setInterval(async () => {
    if (checking || bounded.aborted) return;
    checking = true;
    try {
      const current = await db.creationImport.findUnique({ where: { id }, select: { status: true, attempt: true } });
      if (current?.status !== "running" || current.attempt !== row.attempt) abort.abort();
    } catch { abort.abort(); } finally { checking = false; }
  }, 3000);
  try {
    const blob = row.sourceBlob;
    if (blob.state !== "ready" || blob.userId !== row.userId || blob.bytes > OFFICE_IMPORT_BYTES) throw new AppError("OFFICE_SOURCE_INVALID", 422);
    const bytes = await store.get(blob.objectKey);
    if (bytes.length !== blob.bytes || hash(bytes) !== blob.checksum) throw new AppError("OFFICE_SOURCE_INVALID", 422);
    bounded.throwIfAborted();
    const output = await parse(bytes, { format: row.format, title: row.name.replace(/\.(docx|xlsx|pptx)$/i, "").slice(0, 160), unitId: "office-" + id, sourceId: id }, { signal: bounded });
    bounded.throwIfAborted();
    for (const item of output.media) {
      const objectKey = row.userId + "/creation-imports/" + id + "/" + item.id + ".png";
      await store.put(objectKey, item.data, "image/png");
      await db.asset.upsert({ where: { id: item.id }, update: {}, create: { id: item.id, userId: row.userId, objectKey, kind: "image", status: "active", contentType: "image/png", width: item.width, height: item.height, bytes: item.bytes, checksum: item.checksum } });
    }
    const metadata = row.format === "pptx" ? null : officeImportMetadata(output.content), report = { metadata, unitId: output.content.snapshot?.id || null, warnings: metadata?.warnings || output.warnings || output.content.metadata?.warnings || [] };
    const live = { id, status: "running", attempt: row.attempt, leaseUntil: { gt: new Date() }, deadlineAt: { gt: new Date() } };
    if (!(await db.creationImport.updateMany({ where: live, data: { report } })).count) throw new AppError("OFFICE_LEASE_LOST", 409);
    const createArtifact = row.format === "pptx" ? createLayoutArtifact : createNativeOfficeArtifact;
    await createArtifact(row.userId, row.projectId, output.content, "office_import_" + id, { db, store, hooks: {
      beforeStage: () => bounded.throwIfAborted(),
      beforeCommit: async tx => {
        bounded.throwIfAborted();
        if (!await tx.creationImport.findFirst({ where: { ...live, leaseUntil: { gt: new Date() }, deadlineAt: { gt: new Date() } } })) throw new AppError("OFFICE_LEASE_LOST", 409);
      },
      afterCommit: async (tx, result) => {
        await tx.creationImport.update({ where: { id }, data: { status: "succeeded", artifactId: result.artifactId, leaseUntil: null, errorCode: null } });
      },
    } });
  } catch (error) {
    const code = /^(OFFICE_|CREATION_REFERENCE_|NATIVE_OFFICE_)[A-Z0-9_]+$/.test(error.code || error.message || "") ? error.code || error.message : "OFFICE_TEMPORARY_FAILURE";
    const retry = ["OFFICE_TEMPORARY_FAILURE", "OFFICE_IMPORT_TIMEOUT"].includes(code) && row.attempt < 3 && row.deadlineAt > new Date();
    await db.creationImport.updateMany({ where: { id, status: "running", attempt: row.attempt }, data: { status: retry ? "queued" : "failed", errorCode: code, leaseUntil: null, nextCheckAt: new Date(Date.now() + 30000) } });
  } finally {
    clearInterval(timer);
    while (checking) await new Promise(resolve => setTimeout(resolve, 25));
  }
}
export async function recoverOfficeImports({ db = prisma, now = new Date() } = {}) {
  const rows = await db.creationImport.findMany({ where: { status: { in: active }, nextCheckAt: { lte: now } }, orderBy: { nextCheckAt: "asc" }, take: 25 });
  for (const row of rows) await db.$transaction(async tx => {
    await enqueueOfficeImport(tx, row, now);
    await tx.creationImport.updateMany({ where: { id: row.id, status: row.status, attempt: row.attempt, nextCheckAt: row.nextCheckAt }, data: { nextCheckAt: now } });
  });
  return rows.length;
}
