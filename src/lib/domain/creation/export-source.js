import { createHash } from "node:crypto";
import { objectStorage } from "../../infra/storage/s3.js";
import { AppError } from "../../http.js";

// ArtifactRevision has no schemaVersion column. Read the small, immutable
// revision blob, outside the admission transaction, rather than guessing from
// the current artifact or trusting a client-supplied codec. No engine imports.
export async function readExportSourceFormat(userId, artifactId, revision, { db, store } = {}) {
  const row = await db.artifactRevision.findUnique({ where: { artifactId_revision: { artifactId, revision } }, include: { blob: true } });
  if (!row || row.blob.userId !== userId || row.blob.state !== "ready") throw new AppError("ARTIFACT_REVISION_NOT_FOUND", 404);
  const blob = row.blob;
  if (!Number.isSafeInteger(blob.bytes) || blob.bytes <= 0 || blob.bytes > 2 * 1024 * 1024) throw new AppError("EXPORT_SOURCE_FORMAT_UNSUPPORTED", 422);
  const signal = AbortSignal.timeout(10000), reader = (await (store ?? objectStorage()).stream(blob.objectKey, undefined, signal)).getReader();
  const chunks = [], hash = createHash("sha256"); let size = 0;
  const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read(); signal.throwIfAborted(); if (done) break;
      size += value.byteLength;
      if (size > blob.bytes) throw new AppError("EXPORT_SOURCE_INTEGRITY_FAILED", 422);
      chunks.push(value); hash.update(value);
    }
    if (size !== blob.bytes || hash.digest("hex") !== blob.checksum) throw new AppError("EXPORT_SOURCE_INTEGRITY_FAILED", 422);
  } finally { signal.removeEventListener("abort", cancel); await reader.cancel().catch(() => {}); reader.releaseLock(); }
  let content;
  try { content = JSON.parse(Buffer.concat(chunks, size).toString("utf8")); } catch { throw new AppError("EXPORT_SOURCE_FORMAT_UNSUPPORTED", 422); }
  if (![1, 2, 3].includes(content?.schemaVersion) || !["document", "sheet", "poster", "slides", "web"].includes(content.kind)
    || content.schemaVersion === 3 && (!["poster", "slides"].includes(content.kind) || content.format !== `html-${content.kind}`)
    || content.schemaVersion === 2 && (content.engine !== "univer" || content.engineVersion !== "1.2.0")) throw new AppError("EXPORT_SOURCE_FORMAT_UNSUPPORTED", 422);
  return { revisionId: row.id, checksum: blob.checksum, schemaVersion: content.schemaVersion, kind: content.kind };
}
