import Redis from "ioredis";
import { Queue } from "bullmq";

export const QUEUE_NAME = "modelshot-work-v1";
export function queueConnection() {
  if (!process.env.REDIS_URL) throw new Error("REDIS_URL is required");
  return new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null, connectTimeout: 5000, enableReadyCheck: true });
}
export function workQueue(connection) { return new Queue(QUEUE_NAME, { connection }); }

export async function dispatchOutbox(db, queue, limit = 100) {
  const events = await db.outboxEvent.findMany({ where: { deliveredAt: null, availableAt: { lte: new Date() } }, orderBy: { createdAt: "asc" }, take: limit });
  let sent = 0;
  for (const event of events) {
    await db.outboxEvent.update({ where: { id: event.id }, data: { attempts: { increment: 1 } } });
    await queue.add(event.kind, { id: event.entityId, version: 1 }, { jobId: event.id, attempts: 5, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: { age: 86400 }, removeOnFail: { age: 604800 } });
    await db.outboxEvent.updateMany({ where: { id: event.id, deliveredAt: null }, data: { deliveredAt: new Date() } });
    sent++;
  }
  return sent;
}
