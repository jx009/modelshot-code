import { z } from "zod";
import { layoutId } from "./layout.js";
import { artworkDocumentSchema as layoutDocumentSchema, artworkOperationsSchema as layoutOperationsSchema } from "../artwork-codec.js";

export const createProjectSchema = z.object({
  createKey: z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/),
  name: z.string().trim().min(1).max(160),
  kind: z.enum(["poster", "slides", "document", "sheet", "web"]),
}).strict();
export const createArtifactSchema = z.object({ projectId: layoutId, content: layoutDocumentSchema }).strict();
export const updateProjectSchema = z.union([
  z.object({ name: z.string().trim().min(1).max(100), updatedAt: z.string().datetime() }).strict(),
  z.object({ restore: z.literal(true) }).strict(),
]);
export const copyArtifactSchema = z.object({
  saveKey: z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/), content: layoutDocumentSchema,
}).strict();
export const modifyArtifactSchema = z.object({
  baseRevision: z.number().int().positive(), saveKey: z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/), operations: layoutOperationsSchema,
}).strict();
export const restoreArtifactSchema = z.object({
  baseRevision: z.number().int().positive(), restoreRevision: z.number().int().positive(), saveKey: z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/),
}).strict();
