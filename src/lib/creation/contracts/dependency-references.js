import { z } from "zod";
export const dependencyReferencesSchema = z.array(z.object({
  artifactId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/), revision: z.number().int().positive(),
}).strict()).max(8).default([]);
