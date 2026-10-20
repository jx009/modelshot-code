import { z } from "zod";
import { getSiteConfig } from "../site-config.js";
export const executionSchema = z.object({
  generationConcurrency: z.number().int().min(1).max(4096),
  transferConcurrency: z.number().int().min(1).max(64),
  processingConcurrency: z.number().int().min(1).max(32),
}).strict();
export function executionDefaults(env = process.env) {
  return executionSchema.parse({ generationConcurrency: Number(env.IMAGE_GENERATION_CONCURRENCY) || 128,
    transferConcurrency: Number(env.IMAGE_TRANSFER_CONCURRENCY) || 8, processingConcurrency: Number(env.IMAGE_PROCESSING_CONCURRENCY) || 4 });
}
export async function getExecutionConfig(db) {
  const raw = await getSiteConfig("execution_limits", db);
  return raw ? executionSchema.parse(JSON.parse(raw)) : executionDefaults();
}
