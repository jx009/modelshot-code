import { HTML_PIPELINE_VERSION, HTML_SCHEDULER_HEARTBEAT } from "../lib/creation/contracts/html-runtime.js";
import "dotenv/config";
import { Worker } from "bullmq";
import { prisma } from "../lib/prisma.js";
import { queueConnection, CREATION_QUEUE_NAME } from "../lib/infra/queue/index.js";
import { advanceRun, recoverRuns } from "../lib/domain/creation/scheduler.js";
import { DOCUMENT_PIPELINE_VERSION, DOCUMENT_SCHEDULER_HEARTBEAT } from "../lib/creation/contracts/document-runtime.js";
import { SHEET_PIPELINE_VERSION, SHEET_SCHEDULER_HEARTBEAT } from "../lib/creation/contracts/sheet-runtime.js";
import { WEB_PIPELINE_VERSION, WEB_SCHEDULER_HEARTBEAT } from "../lib/creation/contracts/web-runtime.js";
import { POSTER_IMAGE_PIPELINE_VERSION, POSTER_IMAGE_SCHEDULER_HEARTBEAT } from "../lib/creation/contracts/poster-runtime.js";
import { cleanupExpiredCreationBlobs } from "../lib/domain/creation/blob-maintenance.js";
import { objectStorage } from "../lib/infra/storage/s3.js";

// A separate process: orchestration cannot consume payment/refund slots. This
// worker submits existing jobs; it does not run Chromium or Office conversion.
const connection = queueConnection();
const concurrency = Math.min(4, Math.max(1, Number(process.env.CREATION_SCHEDULER_CONCURRENCY) || 2));
const worker = new Worker(CREATION_QUEUE_NAME, async job => {
  if (!["creation-advance", "creation-notify"].includes(job.name) || job.data.version !== 1 || typeof job.data.id !== "string") throw new Error("Unsupported creation payload");
  if (job.name === "creation-notify") await connection.publish("modelshot:creation:events", job.data.id);
  else await advanceRun(job.data.id);
}, { connection, concurrency });
worker.on("error", () => console.error(JSON.stringify({ code: "CREATION_WORKER_ERROR" })));
worker.on("failed", job => console.error(JSON.stringify({ code: "CREATION_WAKE_FAILED", runId: job?.data?.id })));
connection.on("error", () => console.error(JSON.stringify({ code: "CREATION_REDIS_UNAVAILABLE" })));
let stopping = false, recovering = false;
async function recover() {
  if (stopping || recovering) return;
  recovering = true;
  try {
    await recoverRuns();
    await prisma.serviceHeartbeat.upsert({ where: { id: HTML_SCHEDULER_HEARTBEAT }, create: { id: HTML_SCHEDULER_HEARTBEAT, details: { version: HTML_PIPELINE_VERSION } }, update: { updatedAt: new Date(), details: { version: HTML_PIPELINE_VERSION } } });
      await prisma.serviceHeartbeat.upsert({ where: { id: POSTER_IMAGE_SCHEDULER_HEARTBEAT },
      create: { id: POSTER_IMAGE_SCHEDULER_HEARTBEAT, details: { version: POSTER_IMAGE_PIPELINE_VERSION } },
      update: { updatedAt: new Date(), details: { version: POSTER_IMAGE_PIPELINE_VERSION } } });
    await prisma.serviceHeartbeat.upsert({ where: { id: "creation-worker" },
      create: { id: "creation-worker", details: { queue: CREATION_QUEUE_NAME } }, update: { updatedAt: new Date() } });
    await prisma.serviceHeartbeat.upsert({ where: { id: DOCUMENT_SCHEDULER_HEARTBEAT },
      create: { id: DOCUMENT_SCHEDULER_HEARTBEAT, details: { version: DOCUMENT_PIPELINE_VERSION } },
      update: { updatedAt: new Date(), details: { version: DOCUMENT_PIPELINE_VERSION } } });
    await prisma.serviceHeartbeat.upsert({ where: { id: SHEET_SCHEDULER_HEARTBEAT },
      create: { id: SHEET_SCHEDULER_HEARTBEAT, details: { version: SHEET_PIPELINE_VERSION } },
      update: { updatedAt: new Date(), details: { version: SHEET_PIPELINE_VERSION } } });
    await prisma.serviceHeartbeat.upsert({ where: { id: WEB_SCHEDULER_HEARTBEAT },
      create: { id: WEB_SCHEDULER_HEARTBEAT, details: { version: WEB_PIPELINE_VERSION } },
      update: { updatedAt: new Date(), details: { version: WEB_PIPELINE_VERSION } } });
  } catch { console.error(JSON.stringify({ code: "CREATION_RECOVERY_FAILED" })); }
  finally { recovering = false; }
}
await recover();
const timer = setInterval(recover, 30_000);
// Independent from recovery/heartbeats. Bounded, serial storage cleanup never
// holds a database transaction or consumes a model/payment queue slot.
let maintaining = false;
async function maintain() {
  if (stopping || maintaining) return;
  maintaining = true;
  const started = Date.now();
  try {
    const result = await cleanupExpiredCreationBlobs({ db: prisma, store: objectStorage(), limit: 25, shouldStop: () => stopping || Date.now() - started >= 20000 });
    if (result.failed) console.error(JSON.stringify({ code: "CREATION_BLOB_CLEANUP_PARTIAL", failed: result.failed }));
  } catch { console.error(JSON.stringify({ code: "CREATION_BLOB_CLEANUP_FAILED" })); }
  finally { maintaining = false; }
}
const maintenanceTimer = setInterval(maintain, 60000);
console.log(JSON.stringify({ code: "CREATION_WORKER_READY", queue: CREATION_QUEUE_NAME }));
async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  clearInterval(maintenanceTimer);
  const force = setTimeout(() => { void worker.close(true); }, 20_000);
  force.unref();
  try {
    await worker.close();
    while (recovering || maintaining) await new Promise(resolve => setTimeout(resolve, 100));
    await connection.quit();
    await prisma.$disconnect();
  } finally { clearTimeout(force); }
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
