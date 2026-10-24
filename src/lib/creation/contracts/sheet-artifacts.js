import { z } from "zod";
import { sheetId, workbookSchema, sheetOperationSchema } from "./sheet.js";
export const createSheetArtifactSchema = z.object({ projectId: sheetId, saveKey: z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/), content: workbookSchema }).strict();
export const modifySheetArtifactSchema = z.object({ baseRevision: z.number().int().positive(), saveKey: z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/), operations: sheetOperationSchema }).strict();
export const copySheetArtifactSchema = z.object({ saveKey: z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/), content: workbookSchema }).strict();
export const restoreSheetArtifactSchema = z.object({ baseRevision: z.number().int().positive(), restoreRevision: z.number().int().positive(), saveKey: z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/) }).strict();
