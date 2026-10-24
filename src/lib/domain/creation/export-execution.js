import { createHash, randomUUID } from "node:crypto";
import { isHtmlDocument, htmlAssetIds } from "../../creation/html/document.js";
import { prisma } from "../../prisma.js";
import { objectStorage } from "../../infra/storage/s3.js";
import { AppError } from "../../http.js";
import { lockUser } from "../billing/ledger.js";
import { exportFormatForVersion, exportSupportsKind, hasExportSignature, EXPORT_MAX_BYTES } from "../../creation/contracts/exports.js";
import { validateLayoutPdf, pdfAssetIds } from "../../creation/exports/pdf-policy.js";
import { readLayoutArtifact } from "./artifacts.js";
import { enqueueExport } from "./exports.js";
import { renderLayoutInProcess } from "./export-process.js";
import { officeImportMetadata, officeEqual } from "../../creation/office/identity.js";

const transient = new Set(["EXPORT_RENDER_FAILED", "EXPORT_RENDER_TIMEOUT", "EXPORT_TEMPORARY_FAILURE"]);
const active = ["queued", "running"];
function failureCode(error) { return /^EXPORT_[A-Z_]+$/.test(error.code || "") ? error.code : ["ARTIFACT_FORMAT_UNSUPPORTED", "ARTIFACT_KIND_MISMATCH"].includes(error.code) ? "EXPORT_SOURCE_FORMAT_UNSUPPORTED" : error.code === "ARTIFACT_INTEGRITY_FAILED" ? "EXPORT_SOURCE_INTEGRITY_FAILED" : ["ARTIFACT_NOT_FOUND", "ASSET_NOT_FOUND", "ARTIFACT_REVISION_NOT_FOUND"].includes(error.code) ? "EXPORT_SOURCE_UNAVAILABLE" : "EXPORT_TEMPORARY_FAILURE"; }

async function claim(id, db, now) {
  const row = await db.artifactExport.findUnique({ where: { id }, include: { revision: true } });
  if (!row || !active.includes(row.status)) return null;
  return db.$transaction(async tx => {
    await lockUser(tx, row.userId);
    const current = await tx.artifactExport.findUnique({ where: { id }, include: { revision: true } });
    if (!current || !active.includes(current.status) || current.status === "running" && current.leaseUntil > now) return null;
    const supported = Boolean(exportFormatForVersion(current.format, current.exporterVersion));
    if (current.deadlineAt <= now || current.attempt >= current.attemptLimit || !supported) {
      await tx.artifactExport.update({ where: { id }, data: { status: "failed", errorCode: !supported ? "EXPORT_VERSION_UNSUPPORTED" : "EXPORT_DEADLINE_EXCEEDED", leaseUntil: null } });
      return null;
    }
    // Duplicate/out-of-order queue wakes must not bypass transient backoff.
    if (current.status === "queued" && current.nextCheckAt > now) return null;
    const leaseUntil = new Date(+now + 6 * 60000);
    return tx.artifactExport.update({ where: { id }, data: { status: "running", attempt: { increment: 1 }, leaseUntil, nextCheckAt: leaseUntil, errorCode: null }, include: { revision: true } });
  });
}
export async function executeArtifactExport(id, { db = prisma, store = objectStorage(), render = renderLayoutInProcess, signal } = {}) {
  const row = await claim(id, db, new Date());
  if (!row) return;
  const abort = new AbortController(), bounded = AbortSignal.any([abort.signal, AbortSignal.timeout(5 * 60000), ...(signal ? [signal] : [])]);
  let checking = false;
  const timer = setInterval(async () => {
    if (checking || bounded.aborted) return;
    checking = true;
    try {
      const current = await db.artifactExport.findUnique({ where: { id }, select: { status: true, attempt: true } });
      if (!current || current.status !== "running" || current.attempt !== row.attempt) abort.abort();
    } catch { abort.abort(); }
    finally { checking = false; }
  }, 5000);
  try {
    const descriptor = exportFormatForVersion(row.format, row.exporterVersion);
    let source;
    if (descriptor.sourceSchemaVersion === 2) {
      const { readNativeOfficeArtifact } = await import("./native-office-artifacts.js");
      source = await readNativeOfficeArtifact(row.userId, row.revision.artifactId, descriptor.kind, row.revision.revision, { db, store });
    } else {
      const read = descriptor.kind === "document" ? (await import("./document-artifacts.js")).readDocumentArtifact : descriptor.kind === "sheet" ? (await import("./sheet-artifacts.js")).readSheetArtifact : descriptor.kind === "web" ? (await import("./web-artifacts.js")).readWebArtifact : readLayoutArtifact;
      source = await read(row.userId, row.revision.artifactId, row.revision.revision, { db, store });
    }
    if (!exportSupportsKind(descriptor, source.content.kind)) throw new AppError("EXPORT_KIND_UNSUPPORTED", 422);
    if ((source.content.schemaVersion ?? 1) !== (descriptor.sourceSchemaVersion ?? 1)) throw new AppError("EXPORT_SOURCE_FORMAT_UNSUPPORTED", 422);
    let pdfPages;
    if (row.format === "pdf" && descriptor.kind !== "document" && !isHtmlDocument(source.content)) {
      try { pdfPages = validateLayoutPdf(source.content).pages; }
      catch (error) { throw new AppError(/^EXPORT_/.test(error.message) ? error.message : "EXPORT_SOURCE_FORMAT_UNSUPPORTED", 422); }
    }
    const ids = [...new Set(isHtmlDocument(source.content) ? htmlAssetIds(source.content) : pdfPages ? pdfAssetIds(pdfPages) : descriptor.sourceSchemaVersion === 2 ? source.content.assetIds : descriptor.kind === "document"
      ? source.content.sections.flatMap(section => section.blocks.filter(block => block.type === "image").map(block => block.assetId))
      : descriptor.kind === "sheet" ? []
      : descriptor.kind === "web" ? source.content.files.filter(file => file.kind === "asset").map(file => file.assetId)
      : source.content.pages.flatMap(page => page.nodes.filter(node => node.visible && node.type === "image").map(node => node.assetId)))];
    if (ids.length > 100) throw new AppError("EXPORT_ASSETS_TOO_LARGE", 413);
    const assets = await db.asset.findMany({ where: { id: { in: ids }, userId: row.userId, status: "active", contentType: { in: ["image/png", "image/jpeg", "image/webp"] } }, select: { id: true, objectKey: true, bytes: true, checksum: true } });
    if (assets.length !== ids.length) throw new AppError("ASSET_NOT_FOUND", 404);
    if (assets.some(asset => !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 || asset.bytes > 50 * 1024 * 1024) || assets.reduce((sum, asset) => sum + asset.bytes, 0) > 100 * 1024 * 1024) throw new AppError("EXPORT_ASSETS_TOO_LARGE", 413);
    bounded.throwIfAborted();
    let original;
    const imported = officeImportMetadata(source.content);
    if (imported) {
      const retained = await db.creationImport.findFirst({ where: { id: imported.sourceId, userId: row.userId, status: "succeeded" }, include: { sourceBlob: true } });
      if (!retained || !officeEqual(retained.report?.metadata, imported) || retained.sourceBlob.userId !== row.userId || retained.sourceBlob.state !== "ready") throw new AppError("EXPORT_SOURCE_INTEGRITY_FAILED", 422);
      original = retained.sourceBlob;
    }
    const output = await render(source.content, assets, { store, signal: bounded, format: row.format, exporterVersion: row.exporterVersion, original });
    bounded.throwIfAborted();
    if (!Buffer.isBuffer(output) || output.length > EXPORT_MAX_BYTES || !hasExportSignature(output, row.format)) throw new AppError("EXPORT_RESULT_INVALID", 422);
    const blob = await db.creationBlob.create({ data: { userId: row.userId, objectKey: `${row.userId}/creation-exports/${id}/${row.attempt}-${randomUUID()}.${descriptor.extension}`, checksum: createHash("sha256").update(output).digest("hex"), bytes: output.length, expiresAt: new Date(Date.now() + 86400000) } });
    await store.put(blob.objectKey, output, descriptor.contentType);
    bounded.throwIfAborted();
    await db.$transaction(async tx => {
      await lockUser(tx, row.userId);
      const project = await tx.creationArtifact.findFirst({ where: { id: source.id, deletedAt: null, project: { userId: row.userId, deletedAt: null } }, select: { id: true } });
      if (!project) throw new AppError("ARTIFACT_NOT_FOUND", 404);
      if (ids.length && await tx.asset.count({ where: { id: { in: ids }, userId: row.userId, status: "active" } }) !== ids.length) throw new AppError("ASSET_NOT_FOUND", 404);
      const completed = await tx.artifactExport.updateMany({ where: { id, status: "running", attempt: row.attempt, leaseUntil: { gt: new Date() }, deadlineAt: { gt: new Date() } }, data: { status: "succeeded", blobId: blob.id, leaseUntil: null, errorCode: null } });
      if (!completed.count) throw new AppError("EXPORT_LEASE_LOST", 409);
      const ready = await tx.creationBlob.updateMany({ where: { id: blob.id, state: "staging" }, data: { state: "ready" } });
      if (!ready.count) throw new AppError("EXPORT_UPLOAD_EXPIRED", 409);
    });
  } catch (error) {
    const code = bounded.aborted ? "EXPORT_TEMPORARY_FAILURE" : failureCode(error);
    const retry = transient.has(code) && row.attempt < row.attemptLimit && row.deadlineAt > new Date();
    await db.artifactExport.updateMany({ where: { id, status: "running", attempt: row.attempt }, data: { status: retry ? "queued" : "failed", errorCode: code, leaseUntil: null, nextCheckAt: new Date(Date.now() + 30000) } });
  } finally {
    clearInterval(timer);
    while (checking) await new Promise(resolve => setTimeout(resolve, 50));
  }
}
export async function recoverArtifactExports({ db = prisma, now = new Date() } = {}) {
  const rows = await db.artifactExport.findMany({ where: { status: { in: active }, nextCheckAt: { lte: now } }, orderBy: { nextCheckAt: "asc" }, take: 25 });
  for (const row of rows) await db.$transaction(async tx => {
    await lockUser(tx, row.userId);
    const current = await tx.artifactExport.findUnique({ where: { id: row.id } });
    if (!current || !active.includes(current.status) || current.nextCheckAt > now) return;
    if (current.deadlineAt <= now || current.attempt >= current.attemptLimit) {
      await tx.artifactExport.update({ where: { id: row.id }, data: { status: "failed", errorCode: "EXPORT_DEADLINE_EXCEEDED", leaseUntil: null } });
      return;
    }
    await enqueueExport(tx, current, now);
    // Rotate due work without postponing the queued task we just woke. A
    // running task is still gated by its lease in claim(). Recovery itself runs
    // every 30 seconds and the outbox wake is deduplicated in that time bucket.
    await tx.artifactExport.update({ where: { id: row.id }, data: { nextCheckAt: current.status === "queued" ? now : new Date(+now + 30000) } });
  });
  return rows.length;
}
