import Redis from "ioredis";
import { Queue } from "bullmq";

export const QUEUE_NAME = "modelshot-work-v1";
export const MIRROR_QUEUE_NAME = "modelshot-asset-mirror-v1";
export const GENERATION_QUEUE_NAME = "modelshot-generation-v1";
export const CREATION_QUEUE_NAME = "modelshot-creation-v1";
export const CREATION_LANGUAGE_QUEUE_NAME = "modelshot-creation-language-v1";
export const CREATION_EXPORT_QUEUE_NAME = "modelshot-creation-export-v1";
export function queueConnection() {
  if (!process.env.REDIS_URL) throw new Error("REDIS_URL is required");
  return new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null, connectTimeout: 5000, enableReadyCheck: true });
}
export function workQueue(connection) { return new Queue(QUEUE_NAME, { connection }); }

export async function dispatchOutbox(db, queue, limit = 100, mirrorQueue, generationQueue, creationQueue, languageQueue, exportQueue) {
  const excluded = [...(!creationQueue ? ["creation-advance", "creation-notify"] : []), ...(!languageQueue ? ["creation-language"] : []), ...(!exportQueue ? ["creation-export", "creation-import"] : [])];
  const events = await db.outboxEvent.findMany({ where: { deliveredAt: null, availableAt: { lte: new Date() }, ...(excluded.length ? { kind: { notIn: excluded } } : {}) }, orderBy: { createdAt: "asc" }, take: limit });
  let sent = 0;
  for (const event of events) {
    const isMirror = ["asset-mirror", "asset-mirror-delete", "inspiration-mirror"].includes(event.kind);
    if (isMirror && !mirrorQueue) continue;
    await db.outboxEvent.update({ where: { id: event.id }, data: { attempts: { increment: 1 } } });
    const target = ["creation-export", "creation-import"].includes(event.kind) ? exportQueue : event.kind === "creation-language" ? languageQueue : ["creation-advance", "creation-notify"].includes(event.kind) ? creationQueue : isMirror ? mirrorQueue : event.kind === "generate" && generationQueue ? generationQueue : queue;
    if (!target) continue;
    await target.add(event.kind, { id: event.entityId, version: 1 }, { jobId: event.id, attempts: 5, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: { age: 86400 }, removeOnFail: { age: 604800 } });
    await db.outboxEvent.updateMany({ where: { id: event.id, deliveredAt: null }, data: { deliveredAt: new Date() } });
    sent++;
  }
  return sent;
}
