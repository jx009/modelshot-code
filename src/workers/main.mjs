import "dotenv/config";
import { Worker } from "bullmq";
import { prisma } from "../lib/prisma.js";
import { queueConnection, workQueue, QUEUE_NAME, dispatchOutbox } from "../lib/infra/queue/index.js";
import { executeOutput } from "../lib/domain/generation/execution.js";
import { recoverWork } from "../lib/domain/generation/recovery.js";
import { processDelivery, processQuality } from "../lib/domain/generation/delivery.js";
import { processExport } from "../lib/domain/generation/exports.js";
import { processPaymentEvent } from "../lib/domain/billing/payments.js";
import { getStripe } from "../lib/stripe.js";
import { processRefundRequest } from "../lib/domain/billing/operations.js";
import { cleanupStorage } from "../lib/domain/assets/lifecycle.js";
import { validateEnvironment } from "../lib/infra/environment.js";
import { processSubscriptionChange } from "../lib/domain/billing/subscription-changes.js";

validateEnvironment();
const connection = queueConnection();
const queue = workQueue(connection);
const handlers = { generate: executeOutput, delivery: processDelivery, qa: processQuality, export: processExport, payment: async id => processPaymentEvent(id, { stripe: await getStripe() }), refund: async id => processRefundRequest(id, { stripe: await getStripe() }) };
handlers.subscription = async id => processSubscriptionChange(id, { stripe: await getStripe() });
const worker = new Worker(QUEUE_NAME, async job => {
  if (job.data.version !== 1 || typeof job.data.id !== "string" || !handlers[job.name]) throw new Error("Unsupported queue payload");
  await handlers[job.name](job.data.id);
}, { connection, concurrency: Math.min(8, Math.max(1, Number(process.env.WORKER_CONCURRENCY) || 2)), limiter: { max: 30, duration: 60_000 } });
worker.on("failed", (job, error) => {
  const message = String(error?.message || "unknown worker error")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/\s+/g, " ")
    .slice(0, 220);
  console.error(JSON.stringify({ code: "WORK_FAILED", kind: job?.name, entityId: job?.data?.id, errorCode: error?.code || null, status: error?.status || error?.statusCode || null, message }));
});
worker.on("error", () => console.error(JSON.stringify({ code: "WORKER_CONNECTION_ERROR" })));
connection.on("error", () => console.error(JSON.stringify({ code: "REDIS_UNAVAILABLE" })));
let stopping = false;
let dispatching = false;
let iteration = 0;
async function tick() {
  if (stopping || dispatching) return;
  dispatching = true;
  try {
    if (iteration++ % 15 === 0) {
      await recoverWork(prisma);
    }
    if (iteration % 1800 === 1) await cleanupStorage();
    await dispatchOutbox(prisma, queue);
    await prisma.serviceHeartbeat.upsert({ where: { id: "worker" }, create: { id: "worker", details: { queue: QUEUE_NAME } }, update: { updatedAt: new Date() } });
  } catch { console.error(JSON.stringify({ code: "DISPATCH_RETRY_PENDING" })); }
  finally { dispatching = false; }
}
const timer = setInterval(tick, 2000);
await tick();
console.log(JSON.stringify({ code: "WORKER_READY", queue: QUEUE_NAME }));
async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  await worker.close();
  while (dispatching) await new Promise(resolve => setTimeout(resolve, 100));
  await queue.close();
  await connection.quit();
  await prisma.$disconnect();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
