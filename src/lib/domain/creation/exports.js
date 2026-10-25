import { createHash } from "node:crypto";
import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";
import { lockUser } from "../billing/ledger.js";
import { ownedArtifact } from "./artifacts.js";
import { exportFormat, exportFormatForVersion, exportFormatsForKind, exportSupportsKind, requestExportSchema } from "../../creation/contracts/exports.js";
import { readExportSourceFormat } from "./export-source.js";

const active = ["queued", "running"];
const enabled = (descriptor, env) => Boolean(descriptor && env[descriptor.flag] === "true" && (descriptor.sourceSchemaVersion !== 2 || env.CREATION_NATIVE_OFFICE_ENABLED === "true"));
export const exportFields = { id: true, userId: true, revisionId: true, format: true, exporterVersion: true, status: true, attempt: true,
  attemptLimit: true, retryKey: true, leaseUntil: true, deadlineAt: true, nextCheckAt: true, errorCode: true, blobId: true, createdAt: true, updatedAt: true };
export function presentExport(row) {
  return { id: row.id, format: row.format, status: row.status, revision: row.revision.revision, artifactId: row.revision.artifactId,
    exporterVersion: row.exporterVersion, attempt: row.attempt, errorCode: row.errorCode, createdAt: row.createdAt, updatedAt: row.updatedAt,
    warnings: exportFormatForVersion(row.format, row.exporterVersion)?.warnings || [], downloadUrl: row.status === "succeeded" ? `/api/creation/exports/${row.id}/download` : null };
}
const revisionSelect = { revision: true, artifactId: true };
export async function ownedExport(userId, id, db = prisma) {
  const row = await db.artifactExport.findFirst({ where: { id, userId, revision: { artifact: { deletedAt: null, project: { userId, deletedAt: null } } } },
    select: { ...exportFields, revision: { select: revisionSelect } } });
  if (!row) throw new AppError("EXPORT_NOT_FOUND", 404);
  return row;
}
async function admit(tx, userId, now, env, format, descriptor) {
  if (!enabled(descriptor, env)) throw new AppError("EXPORT_NOT_ENABLED", 503);
  const heartbeat = await tx.serviceHeartbeat.findUnique({ where: { id: "creation-export-worker" } });
  const workerVersion = heartbeat?.details?.exporters?.[descriptor.workerKey || format] ?? (format === "pptx" ? heartbeat?.details?.exporterVersion : null);
  if (!heartbeat || heartbeat.updatedAt <= new Date(+now - 90000) || workerVersion !== descriptor.version) throw new AppError("EXPORT_WORKER_UNAVAILABLE", 503);
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('creation-export-admission', 0))::text`;
  const imports = tx.creationImport ? await tx.creationImport.count({ where: { status: { in: active } } }) : 0;
  const userImports = tx.creationImport ? await tx.creationImport.count({ where: { userId, status: { in: active } } }) : 0;
  if (imports + await tx.artifactExport.count({ where: { status: { in: active } } }) >= 50) throw new AppError("EXPORT_QUEUE_FULL", 503);
  if (userImports + await tx.artifactExport.count({ where: { userId, status: { in: active } } }) >= 2) throw new AppError("EXPORT_USER_QUEUE_FULL", 429);
}
export async function enqueueExport(tx, row, now) {
  // Recovery may wake a queued row again. Every wake is idempotent at the lease.
  const key = `creation-export:${row.id}:${row.attempt}:${Math.floor(+now / 30000)}`;
  await tx.outboxEvent.upsert({ where: { businessKey: key }, update: {}, create: { businessKey: key, kind: "creation-export", entityId: row.id } });
}
export async function requestArtifactExport(userId, artifactId, input, { db = prisma, store, env = process.env, now = new Date(), hooks } = {}) {
  const data = requestExportSchema.parse(input);
  let source, sourceKind;
  if (["docx", "markdown", "xlsx", "pdf", "png", "jpeg", "svg", "pptx"].includes(data.format)) {
    const artifact = await ownedArtifact(userId, artifactId, db);
    sourceKind = artifact.kind;
    if (!exportSupportsKind(exportFormat(data.format, 1, sourceKind), sourceKind)) throw new AppError("EXPORT_KIND_UNSUPPORTED", 422);
    source = await readExportSourceFormat(userId, artifactId, data.revision, { db, store });
  }
  const descriptor = exportFormat(data.format, source?.schemaVersion ?? 1, sourceKind);
  if (!descriptor) throw new AppError("EXPORT_SOURCE_FORMAT_UNSUPPORTED", 422);
  if (source && !exportSupportsKind(descriptor, source.kind)) throw new AppError("EXPORT_KIND_UNSUPPORTED", 422);
  return db.$transaction(async tx => {
    await lockUser(tx, userId);
    await hooks?.beforeCommit?.(tx);
    const artifact = await ownedArtifact(userId, artifactId, tx);
    if (!exportSupportsKind(descriptor, artifact.kind)) throw new AppError("EXPORT_KIND_UNSUPPORTED", 422);
    const revision = await tx.artifactRevision.findUnique({ where: { artifactId_revision: { artifactId, revision: data.revision } },
      select: { id: true, blob: { select: { checksum: true, state: true, userId: true } } } });
    if (!revision || revision.blob.state !== "ready" || revision.blob.userId !== userId) throw new AppError("ARTIFACT_REVISION_NOT_FOUND", 404);
    if (source && (source.revisionId !== revision.id || source.checksum !== revision.blob.checksum)) throw new AppError("EXPORT_SOURCE_INTEGRITY_FAILED", 422);
    const fingerprint = createHash("sha256").update(JSON.stringify([userId, revision.id, revision.blob.checksum, data.format, descriptor.version])).digest("hex");
    const previous = await tx.artifactExport.findUnique({ where: { fingerprint }, select: { ...exportFields, revision: { select: revisionSelect } } });
    if (previous && (active.includes(previous.status) || previous.status === "succeeded" || !data.retryKey || previous.retryKey === data.retryKey)) { await hooks?.afterCommit?.(tx, presentExport(previous)); return presentExport(previous); }
    if (data.retryKey && (!previous || previous.attempt !== data.retryAttempt)) throw new AppError("EXPORT_RETRY_CHANGED", 409);
    await admit(tx, userId, now, env, data.format, descriptor);
    // For queued rows nextCheckAt is the earliest execution time, not just a
    // recovery hint. New/explicit retry requests are eligible immediately.
    const common = { status: "queued", errorCode: null, leaseUntil: null, nextCheckAt: now, deadlineAt: new Date(+now + 15 * 60000), retryKey: data.retryKey || null };
    const row = previous ? await tx.artifactExport.update({ where: { id: previous.id }, data: { ...common, attemptLimit: previous.attempt + 3 }, select: { ...exportFields, revision: { select: revisionSelect } } })
      : await tx.artifactExport.create({ data: { ...common, userId, revisionId: revision.id, format: data.format, exporterVersion: descriptor.version, fingerprint }, select: { ...exportFields, revision: { select: revisionSelect } } });
    await enqueueExport(tx, row, now);
    await hooks?.afterCommit?.(tx, presentExport(row));
    return presentExport(row);
  }, { timeout: 15000 });
}
export async function cancelArtifactExport(userId, id, db = prisma) {
  return db.$transaction(async tx => {
    await lockUser(tx, userId);
    const row = await ownedExport(userId, id, tx);
    await tx.artifactExport.updateMany({ where: { id, status: { in: active } }, data: { status: "cancelled", errorCode: null, leaseUntil: null } });
    return presentExport(await ownedExport(userId, row.id, tx));
  });
}
export async function listArtifactExports(userId, artifactId, db = prisma) {
  const artifact = await ownedArtifact(userId, artifactId, db);
  const rows = await db.artifactExport.findMany({ where: { userId, revision: { artifactId } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 12,
    select: { ...exportFields, revision: { select: revisionSelect } } });
  const formats = exportFormatsForKind(artifact.kind).map(format => {
    const descriptor = exportFormat(format, artifact.schemaVersion, artifact.kind);
    return { format, enabled: enabled(descriptor, process.env) };
  });
  return { items: rows.map(row => ({ ...presentExport(row), canRetry: ["failed", "cancelled"].includes(row.status) && enabled(exportFormatForVersion(row.format, row.exporterVersion), process.env) })), formats, enabled: formats.some(item => item.enabled) };
}
