import { prisma } from "../../prisma.js";
import { objectStorage } from "../../infra/storage/s3.js";
import { ConcurrencyGate } from "../../infra/concurrency.js";
import { AppError } from "../../http.js";
import { referenceType, referenceContentType, REFERENCE_TEXT_BYTES, REFERENCE_OFFICE_BYTES, REFERENCE_SESSION_BYTES, REFERENCE_CONTEXT_BYTES, REFERENCE_MAX_FILES, REFERENCE_READER_VERSION } from "../../creation/reference-policy.js";
import { decodeReferenceText } from "../../creation/reference-text.js";
import { readReferenceBytes } from "./reference-read.js";
import { extractReferenceInProcess } from "./reference-process.js";

// Only the language worker calls this reader. One download/parser at a time,
// independent from its model-call concurrency. A cache never bypasses ownership.
export function createReferenceReader({ extract = extractReferenceInProcess } = {}) {
  const gate = new ConcurrencyGate(1), cache = new Map(); let cacheBytes = 0;
  const remove = (key, entry) => { cache.delete(key); cacheBytes -= entry.bytes; };
  async function read(file, userId, store, signal) {
    return gate.run(async () => {
      signal.throwIfAborted();
      const type = referenceType(file.fileType), key = JSON.stringify([userId, file.id, file.fileType, file.bytes, file.checksum, REFERENCE_READER_VERSION]);
      const previous = cache.get(key);
      if (previous && previous.until > Date.now()) return previous.value;
      if (previous) remove(key, previous);
      const bytes = await readReferenceBytes(file, store, signal);
      let value;
      if (type.office) value = await extract(bytes, file.fileType, { signal });
      else {
        try { value = { text: decodeReferenceText(bytes) }; } catch { throw new AppError("CREATION_REFERENCE_INVALID", 422); }
      }
      signal.throwIfAborted();
      const size = Buffer.byteLength(JSON.stringify(value));
      if (!value || typeof value.text !== "string" || size > REFERENCE_CONTEXT_BYTES) throw new AppError("CREATION_REFERENCE_CONTEXT_LIMIT", 413);
      for (const [oldKey, entry] of cache) if (entry.until <= Date.now()) remove(oldKey, entry);
      while (cache.size && (cache.size >= 32 || cacheBytes + size > 4 * 1024 * 1024)) { const [oldKey, entry] = cache.entries().next().value; remove(oldKey, entry); }
      if (type.office) { cache.set(key, { value, bytes: size, until: Date.now() + 10 * 60000 }); cacheBytes += size; }
      return value;
    });
  }
  return async function prepare(userId, sessionId, inputIds, { db = prisma, store = objectStorage(), signal: outerSignal } = {}) {
    const ids = [...new Set(inputIds || [])];
    if (!ids.length) return [];
    if (ids.length > REFERENCE_MAX_FILES) throw new AppError("CREATION_REFERENCE_COUNT_LIMIT", 413);
    const files = await db.creationReference.findMany({ where: { id: { in: ids }, userId, sessionId, deletedAt: null, session: { project: { userId, deletedAt: null } } }, select: { id: true, name: true, fileType: true, contentType: true, bytes: true, checksum: true, objectKey: true } });
    if (files.length !== ids.length) throw new AppError("CREATION_REFERENCE_NOT_FOUND", 404);
    // Raw text can be rejected before any download. Office has a separate
    // binary budget; context limits apply to its extracted, labelled text.
    if (files.filter(file => !referenceType(file.fileType)?.office).reduce((sum, file) => sum + file.bytes, 0) > REFERENCE_CONTEXT_BYTES) throw new AppError("CREATION_REFERENCE_CONTEXT_LIMIT", 413);
    for (const file of files) {
      const type = referenceType(file.fileType);
      if (!type || file.contentType !== referenceContentType(type) || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > (type.office ? REFERENCE_OFFICE_BYTES : REFERENCE_TEXT_BYTES)) throw new AppError("CREATION_REFERENCE_INVALID", 422);
    }
    if (files.reduce((sum, file) => sum + file.bytes, 0) > REFERENCE_SESSION_BYTES) throw new AppError("CREATION_REFERENCE_SESSION_LIMIT", 413);
    const signal = AbortSignal.any([AbortSignal.timeout(60000), ...(outerSignal ? [outerSignal] : [])]);
    const result = []; let size = 2;
    for (const id of ids) {
      signal.throwIfAborted();
      const file = files.find(item => item.id === id), value = await read(file, userId, store, signal);
      const prepared = { id: file.id, name: file.name, fileType: file.fileType, ...(referenceType(file.fileType).office ? { sourceChecksum: file.checksum, ...structuredClone(value) } : { text: value.text }) };
      size += Buffer.byteLength(JSON.stringify(prepared)) + 1;
      if (size > REFERENCE_CONTEXT_BYTES) throw new AppError("CREATION_REFERENCE_CONTEXT_LIMIT", 413);
      result.push(prepared);
    }
    return result;
  };
}
export const prepareCreationReferenceFiles = createReferenceReader();
