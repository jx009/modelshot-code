import { z } from "zod";
import { documentId, textDocumentSchema, documentOperationsSchema } from "./document.js";

const saveKey = z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/);
export const createDocumentArtifactSchema = z.object({ projectId: documentId, saveKey, content: textDocumentSchema }).strict();
export const modifyDocumentArtifactSchema = z.object({ baseRevision: z.number().int().positive(), saveKey, operations: documentOperationsSchema }).strict();
export const copyDocumentArtifactSchema = z.object({ saveKey, content: textDocumentSchema }).strict();
