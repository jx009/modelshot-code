import "dotenv/config";
import { Queue, Worker } from "bullmq";
import { prisma } from "../lib/prisma.js";
import { queueConnection, workQueue, QUEUE_NAME, MIRROR_QUEUE_NAME, GENERATION_QUEUE_NAME, CREATION_QUEUE_NAME, CREATION_LANGUAGE_QUEUE_NAME, CREATION_EXPORT_QUEUE_NAME, dispatchOutbox } from "../lib/infra/queue/index.js";
import { getExecutionConfig, executionDefaults } from "../lib/infra/execution-config.js";
import { imageTransfers, imageProcessing } from "../lib/infra/concurrency.js";
import { processCosAsset, processCosRemoval } from "../lib/domain/assets/cos-delivery.js";
import { processInspirationMirror } from "../lib/server/inspiration-delivery.js";
import { executeOutput } from "../lib/domain/generation/execution.js";
import { recoverWork } from "../lib/domain/generation/recovery.js";
import { processDelivery, processQuality } from "../lib/domain/generation/delivery.js";
import { processExport } from "../lib/domain/generation/exports.js";
import { processPaymentEvent } from "../lib/domain/billing/payments.js";
import { getStripe } from "../lib/stripe.js";
import { processRefundRequest } from "../lib/domain/billing/operations.js";
import { cleanupStorage } from "../lib/domain/assets/lifecycle.js";
import { cleanupDirectUploads } from "../lib/domain/assets/direct-upload.js";
import { validateEnvironment } from "../lib/infra/environment.js";
import { processSubscriptionChange } from "../lib/domain/billing/subscription-changes.js";

validateEnvironment();
const connection = queueConnection();
const queue = workQueue(connection);
const mirrorQueue = new Queue(MIRROR_QUEUE_NAME, { connection });
const generationQueue = new Queue(GENERATION_QUEUE_NAME, { connection });
const creationQueue = new Queue(CREATION_QUEUE_NAME, { connection });
const languageQueue = new Queue(CREATION_LANGUAGE_QUEUE_NAME, { connection });
const exportQueue = new Queue(CREATION_EXPORT_QUEUE_NAME, { connection });
const initialLimits = await getExecutionConfig().catch(() => executionDefaults());
imageTransfers.setLimit(initialLimits.transferConcurrency);
imageProcessing.setLimit(initialLimits.processingConcurrency);
const generationWorker = new Worker(GENERATION_QUEUE_NAME, async job => {
  if (job.name !== "generate" || job.data.version !== 1 || typeof job.data.id !== "string") throw new Error("Unsupported generation payload");
  await executeOutput(job.data.id);
}, { connection, concurrency: initialLimits.generationConcurrency });
generationWorker.on("failed", job => console.error(JSON.stringify({ code: "GENERATION_WORK_RETRY", entityId: job?.data?.id })));
generationWorker.on("error", () => console.error(JSON.stringify({ code: "GENERATION_WORKER_ERROR" })));
// Independent concurrency: COS traffic must not occupy model generation slots.
const mirrorWorker = new Worker(MIRROR_QUEUE_NAME, async job => {
  const handlers = { "asset-mirror": processCosAsset, "asset-mirror-delete": processCosRemoval, "inspiration-mirror": processInspirationMirror };
  if (!handlers[job.name] || job.data.version !== 1 || typeof job.data.id !== "string") throw new Error("Unsupported mirror payload");
  await handlers[job.name](job.data.id);
}, { connection, concurrency: 2 });
mirrorWorker.on("failed", job => console.error(JSON.stringify({ code: "COS_MIRROR_RETRY", assetId: job?.data?.id })));
mirrorWorker.on("error", () => console.error(JSON.stringify({ code: "COS_WORKER_ERROR" })));
const handlers = { generate: executeOutput, delivery: processDelivery, qa: processQuality, export: processExport, payment: async id => processPaymentEvent(id, { stripe: await getStripe() }), refund: async id => processRefundRequest(id, { stripe: await getStripe() }) };
handlers.subscription = async id => processSubscriptionChange(id, { stripe: await getStripe() });
const worker = new Worker(QUEUE_NAME, async job => {
  if (job.data.version !== 1 || typeof job.data.id !== "string" || !handlers[job.name]) throw new Error("Unsupported queue payload");
  await handlers[job.name](job.data.id);
}, { connection, concurrency: Math.max(1, Number(process.env.WORKER_CONCURRENCY) || 4) });
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
const shutdownTimeoutMs = Math.min(30_000, Math.max(5_000, Number(process.env.WORKER_SHUTDOWN_TIMEOUT_MS) || 20_000));
async function tick() {
  if (stopping || dispatching) return;
  dispatching = true;
  try {
    if (iteration % 5 === 0) {
      try {
        const limits = await getExecutionConfig();
        generationWorker.concurrency = limits.generationConcurrency;
        imageTransfers.setLimit(limits.transferConcurrency);
        imageProcessing.setLimit(limits.processingConcurrency);
      } catch { console.warn(JSON.stringify({ code: "EXECUTION_CONFIG_RETAINED" })); }
    }
    if (iteration++ % 15 === 0) {
      await recoverWork(prisma);
    }
    if (iteration % 1800 === 1) { await cleanupStorage(); await cleanupDirectUploads(); }
    await dispatchOutbox(prisma, queue, 500, mirrorQueue, generationQueue, creationQueue, languageQueue, exportQueue);
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
  const started = Date.now();
  const forceAt = setTimeout(() => {
    console.error(JSON.stringify({ code: "WORKER_FORCE_CLOSE", timeoutMs: shutdownTimeoutMs }));
    // BullMQ's forced close releases the Redis connection and lets the queue
    // recovery loop reclaim a job whose provider call outlived the container.
    worker.close(true).catch(() => {});
    generationWorker.close(true).catch(() => {});
    mirrorWorker.close(true).catch(() => {});
  }, shutdownTimeoutMs);
  forceAt.unref();
  console.log(JSON.stringify({ code: "WORKER_STOPPING", stage: "drain_active_jobs" }));
  clearInterval(timer);
  try {
    await Promise.all([worker.close(), generationWorker.close(), mirrorWorker.close()]);
    while (dispatching) await new Promise(resolve => setTimeout(resolve, 100));
    await queue.close();
    await mirrorQueue.close();
    await generationQueue.close();
    await creationQueue.close();
    await languageQueue.close();
    await exportQueue.close();
    await connection.quit();
    await prisma.$disconnect();
    console.log(JSON.stringify({ code: "WORKER_STOPPED", durationMs: Date.now() - started }));
  } finally {
    clearTimeout(forceAt);
  }
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
