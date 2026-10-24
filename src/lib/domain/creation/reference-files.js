import { createHash, randomUUID } from "node:crypto";
import { AppError } from "../../http.js";
import { prisma } from "../../prisma.js";
import { objectStorage } from "../../infra/storage/s3.js";
import { REFERENCE_TEXT_BYTES, REFERENCE_OFFICE_BYTES, REFERENCE_SESSION_BYTES, REFERENCE_CONTEXT_BYTES, REFERENCE_MAX_FILES, referenceType, referenceContentType } from "../../creation/reference-policy.js";
import { decodeReferenceText } from "../../creation/reference-text.js";
import { requireOfficeReferences } from "./reference-admission.js";

export const CREATION_REFERENCE_MAX_FILE_BYTES = REFERENCE_TEXT_BYTES;
export const CREATION_REFERENCE_MAX_SESSION_BYTES = REFERENCE_SESSION_BYTES;
export const CREATION_REFERENCE_MAX_CONTEXT_BYTES = REFERENCE_CONTEXT_BYTES;
export const CREATION_REFERENCE_MAX_FILES = REFERENCE_MAX_FILES;

function safeName(name, extension) {
  const leaf = String(name || "").replaceAll("\\", "/").split("/").at(-1).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 160);
  if (!leaf || leaf.length < extension.length + 2) throw new AppError("CREATION_REFERENCE_INVALID", 422);
  return leaf;
}

export async function uploadCreationReference(userId, sessionId, file, { db = prisma, store = objectStorage() } = {}) {
  const extension = String(file?.name || "").split(".").at(-1).toLowerCase();
  const type = referenceType(extension);
  if (!Number.isSafeInteger(file?.size) || file.size < 1) throw new AppError("CREATION_REFERENCE_INVALID", 422);
  if (file.size > (type?.office ? REFERENCE_OFFICE_BYTES : CREATION_REFERENCE_MAX_FILE_BYTES)) throw new AppError("CREATION_REFERENCE_TOO_LARGE", 413);
  if (!type || ![...(type.accepted || [type.mime]), "application/octet-stream", ""].includes(file?.type || "")) throw new AppError("CREATION_REFERENCE_TYPE_UNSUPPORTED", 415);
  const session = await db.creationSession.findFirst({ where: { id: sessionId, project: { userId, deletedAt: null } }, select: { id: true } });
  if (!session) throw new AppError("CREATION_SESSION_NOT_FOUND", 404);
  if (type.office) await requireOfficeReferences(db);
  const name = safeName(file.name, extension), bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length !== file.size) throw new AppError("CREATION_REFERENCE_INVALID", 422);
  if (type.office) {
    if (bytes.length < 22 || bytes.readUInt32LE(0) !== 0x04034b50) throw new AppError("CREATION_REFERENCE_ARCHIVE_INVALID", 422);
  } else { try { decodeReferenceText(bytes); } catch { throw new AppError("CREATION_REFERENCE_INVALID", 422); } }
  const id = randomUUID(), objectKey = `${userId}/creation-references/${sessionId}/${id}.${extension}`;
  const checksum = createHash("sha256").update(bytes).digest("hex");
  try {
    await store.put(objectKey, bytes, referenceContentType(type));
    return await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "CreationSession" WHERE id = ${sessionId} FOR UPDATE`;
      if (!await tx.creationSession.findFirst({ where: { id: sessionId, project: { userId, deletedAt: null } }, select: { id: true } })) throw new AppError("CREATION_SESSION_NOT_FOUND", 404);
      const existing = await tx.creationReference.aggregate({ where: { userId, sessionId, deletedAt: null }, _count: { _all: true }, _sum: { bytes: true } });
      if (existing._count._all >= CREATION_REFERENCE_MAX_FILES) throw new AppError("CREATION_REFERENCE_COUNT_LIMIT", 413);
      if ((existing._sum.bytes || 0) + bytes.length > CREATION_REFERENCE_MAX_SESSION_BYTES) throw new AppError("CREATION_REFERENCE_SESSION_LIMIT", 413);
      return tx.creationReference.create({ data: { id, userId, sessionId, name, fileType: extension, contentType: referenceContentType(type), bytes: bytes.length, checksum, objectKey } });
    }, { timeout: 10000 });
  } catch (error) {
    // A lost transaction acknowledgement may hide a successful commit. Delete
    // only known pre-commit rejections; never erase a possibly committed file.
    if (error instanceof AppError && ["CREATION_REFERENCE_COUNT_LIMIT", "CREATION_REFERENCE_SESSION_LIMIT", "CREATION_SESSION_NOT_FOUND"].includes(error.code)) await store.delete(objectKey).catch(() => {});
    throw error;
  }
}

export async function listCreationReferences(userId, sessionId, db = prisma) {
  const session = await db.creationSession.findFirst({ where: { id: sessionId, project: { userId, deletedAt: null } }, select: { references: { where: { deletedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, fileType: true, contentType: true, bytes: true, createdAt: true } } } });
  if (!session) throw new AppError("CREATION_SESSION_NOT_FOUND", 404);
  return session.references;
}

// Compatibility entrypoint; the Web upload/list path never loads the reader.
export async function prepareCreationReferenceFiles(...args) { return (await import("./reference-reader.js")).prepareCreationReferenceFiles(...args); }
