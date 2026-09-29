import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";

export async function readDocumentPage(userId, id, offset = 0, version, db = prisma) {
  if (!Number.isInteger(offset) || offset < 0 || offset > 20000) throw new AppError("INVALID_CURSOR");
  const rows = await db.$queryRaw`
    SELECT id, name, "nameSource", "createKey", kind, version, "createdAt", "updatedAt",
      jsonb_array_length(content->'layers')::int AS "layerCount",
      (content - 'layers') || jsonb_build_object('layers', COALESCE(
        (SELECT jsonb_agg(value ORDER BY ordinal) FROM jsonb_array_elements(content->'layers') WITH ORDINALITY AS layers(value, ordinal)
          WHERE ordinal > ${offset} AND ordinal <= ${offset + 100}), '[]'::jsonb)) AS content
    FROM "StudioDocument" WHERE id = ${id} AND "userId" = ${userId} AND "deletedAt" IS NULL`;
  const document = rows[0];
  if (!document) throw new AppError("DOCUMENT_NOT_FOUND", 404);
  if (version !== undefined && document.version !== version) throw new AppError("DOCUMENT_VERSION_CONFLICT", 409);
  return document;
}
