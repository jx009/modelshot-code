import { z } from "zod";

const key = z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/);
export const webPublicationActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("publish"), expectedRevision: z.number().int().positive().nullable(), sourceRevision: z.number().int().positive(), saveKey: key }).strict(),
  z.object({ action: z.literal("rollback"), expectedRevision: z.number().int().positive(), targetRevision: z.number().int().positive(), saveKey: key }).strict(),
  z.object({ action: z.literal("revoke"), expectedRevision: z.number().int().positive(), saveKey: key }).strict(),
]);
