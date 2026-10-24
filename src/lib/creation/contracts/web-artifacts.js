import { z } from "zod";
import { webId, webSchema, webOperationsSchema } from "./web.js";
export const createWebArtifactSchema = z.object({ projectId: webId, saveKey: z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/), content: webSchema }).strict();
export const modifyWebArtifactSchema = z.object({ baseRevision: z.number().int().positive(), saveKey: z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/), operations: webOperationsSchema }).strict();
export const copyWebArtifactSchema = z.object({ saveKey: z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/), content: webSchema }).strict();
export const restoreWebArtifactSchema = z.object({ baseRevision: z.number().int().positive(), restoreRevision: z.number().int().positive(), saveKey: z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/) }).strict();
