import { referenceType, REFERENCE_READER_HEARTBEAT, REFERENCE_READER_VERSION } from "../../creation/reference-policy.js";
import { AppError } from "../../http.js";

export async function officeReferencesAvailable(db, now = Date.now(), env = process.env) {
  if (env.CREATION_OFFICE_REFERENCES_ENABLED !== "true") return false;
  const beat = await db.serviceHeartbeat.findUnique({ where: { id: REFERENCE_READER_HEARTBEAT }, select: { updatedAt: true, details: true } });
  return Boolean(beat && now - +beat.updatedAt < 90000 && +beat.updatedAt <= now + 10000 && beat.details?.version === REFERENCE_READER_VERSION && beat.details?.isolated === true);
}
export async function requireOfficeReferences(db, { env = process.env, now = Date.now() } = {}) {
  if (!await officeReferencesAvailable(db, +now, env)) throw new AppError("CREATION_REFERENCE_READER_UNAVAILABLE", 503);
}

// Metadata only: never download or parse Office files inside a transaction.
export async function requireReferenceAdmission(db, userId, sessionId, inputIds, options) {
  const ids = [...new Set(inputIds || [])];
  if (!ids.length) return;
  const files = await db.creationReference.findMany({ where: { id: { in: ids }, userId, sessionId, deletedAt: null, session: { project: { userId, deletedAt: null } } }, select: { id: true, fileType: true } });
  if (files.length !== ids.length) throw new AppError("CREATION_REFERENCE_NOT_FOUND", 404);
  if (files.some(file => referenceType(file.fileType)?.office)) await requireOfficeReferences(db, options);
}
