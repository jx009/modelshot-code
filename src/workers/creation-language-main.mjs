import { AGENT_PIPELINE_VERSION, AGENT_LANGUAGE_HEARTBEAT } from "../lib/creation/contracts/agent.js";
import { HTML_PIPELINE_VERSION, HTML_LANGUAGE_HEARTBEAT } from "../lib/creation/contracts/html-runtime.js";
import "dotenv/config";
import { Worker } from "bullmq";
import { prisma } from "../lib/prisma.js";
import { queueConnection, CREATION_LANGUAGE_QUEUE_NAME } from "../lib/infra/queue/index.js";
import { executeCreationLanguage } from "../lib/domain/creation/language-execution.js";
import { DOCUMENT_PIPELINE_VERSION, DOCUMENT_LANGUAGE_HEARTBEAT } from "../lib/creation/contracts/document-runtime.js";
import { SHEET_PIPELINE_VERSION, SHEET_LANGUAGE_HEARTBEAT } from "../lib/creation/contracts/sheet-runtime.js";
import { WEB_PIPELINE_VERSION, WEB_LANGUAGE_HEARTBEAT } from "../lib/creation/contracts/web-runtime.js";
import { REFERENCE_READER_VERSION, REFERENCE_READER_HEARTBEAT } from "../lib/creation/reference-policy.js";
import { POSTER_IMAGE_PIPELINE_VERSION, POSTER_IMAGE_LANGUAGE_HEARTBEAT } from "../lib/creation/contracts/poster-runtime.js";

// Separate process and queue: long model calls never occupy the lightweight
// creation scheduler or the existing image/payment worker concurrency slots.
if (process.env.CREATION_OFFICE_REFERENCES_ENABLED === "true" && process.env.CREATION_REFERENCE_ISOLATED !== "true") throw new Error("Office reference support requires an isolated creation-language worker host");
if (process.env.CREATION_REFERENCE_ISOLATED === "true") import.meta.resolve("saxes");
const connection = queueConnection();
const configured = Number(process.env.CREATION_LANGUAGE_CONCURRENCY);
const concurrency = Number.isFinite(configured) ? Math.min(4, Math.max(1, Math.floor(configured))) : 2;
const worker = new Worker(CREATION_LANGUAGE_QUEUE_NAME, async job => {
  if (job.name !== "creation-language" || job.data.version !== 1 || typeof job.data.id !== "string") throw new Error("Unsupported language payload");
  await executeCreationLanguage(job.data.id);
}, { connection, concurrency });
worker.on("error", () => console.error(JSON.stringify({ code: "CREATION_LANGUAGE_WORKER_ERROR" })));
worker.on("failed", job => console.error(JSON.stringify({ code: "CREATION_LANGUAGE_RETRY", jobId: job?.data?.id })));
connection.on("error", () => console.error(JSON.stringify({ code: "CREATION_LANGUAGE_REDIS_UNAVAILABLE" })));
let stopping = false, beating = false;
async function heartbeat() {
  if (stopping || beating) return;
  beating = true;
  try {
    await prisma.serviceHeartbeat.upsert({ where: { id: HTML_LANGUAGE_HEARTBEAT }, create: { id: HTML_LANGUAGE_HEARTBEAT, details: { version: HTML_PIPELINE_VERSION } }, update: { updatedAt: new Date(), details: { version: HTML_PIPELINE_VERSION } } });
    await prisma.serviceHeartbeat.upsert({ where: { id: AGENT_LANGUAGE_HEARTBEAT }, create: { id: AGENT_LANGUAGE_HEARTBEAT, details: { version: AGENT_PIPELINE_VERSION } }, update: { updatedAt: new Date(), details: { version: AGENT_PIPELINE_VERSION } } });
      await prisma.serviceHeartbeat.upsert({ where: { id: POSTER_IMAGE_LANGUAGE_HEARTBEAT },
      create: { id: POSTER_IMAGE_LANGUAGE_HEARTBEAT, details: { version: POSTER_IMAGE_PIPELINE_VERSION } },
      update: { updatedAt: new Date(), details: { version: POSTER_IMAGE_PIPELINE_VERSION } } });
    await prisma.serviceHeartbeat.upsert({ where: { id: "creation-language-worker" },
      create: { id: "creation-language-worker", details: { queue: CREATION_LANGUAGE_QUEUE_NAME, concurrency } },
      update: { updatedAt: new Date(), details: { queue: CREATION_LANGUAGE_QUEUE_NAME, concurrency } } });
    await prisma.serviceHeartbeat.upsert({ where: { id: DOCUMENT_LANGUAGE_HEARTBEAT },
      create: { id: DOCUMENT_LANGUAGE_HEARTBEAT, details: { version: DOCUMENT_PIPELINE_VERSION } },
      update: { updatedAt: new Date(), details: { version: DOCUMENT_PIPELINE_VERSION } } });
    await prisma.serviceHeartbeat.upsert({ where: { id: SHEET_LANGUAGE_HEARTBEAT },
      create: { id: SHEET_LANGUAGE_HEARTBEAT, details: { version: SHEET_PIPELINE_VERSION } },
      update: { updatedAt: new Date(), details: { version: SHEET_PIPELINE_VERSION } } });
    await prisma.serviceHeartbeat.upsert({ where: { id: WEB_LANGUAGE_HEARTBEAT },
      create: { id: WEB_LANGUAGE_HEARTBEAT, details: { version: WEB_PIPELINE_VERSION } },
      update: { updatedAt: new Date(), details: { version: WEB_PIPELINE_VERSION } } });
    // Office parsing is allowed only on an explicitly isolated deployment.
    // This is an operator assertion; container CPU/memory/disk/network limits
    // must be set by deployment. No heartbeat is advertised on an ordinary host.
    if (process.env.CREATION_REFERENCE_ISOLATED === "true") await prisma.serviceHeartbeat.upsert({ where: { id: REFERENCE_READER_HEARTBEAT },
      create: { id: REFERENCE_READER_HEARTBEAT, details: { version: REFERENCE_READER_VERSION, isolated: true } },
      update: { updatedAt: new Date(), details: { version: REFERENCE_READER_VERSION, isolated: true } } });
  } catch { console.error(JSON.stringify({ code: "CREATION_LANGUAGE_HEARTBEAT_FAILED" })); }
  finally { beating = false; }
}
await heartbeat();
const timer = setInterval(heartbeat, 30000);
console.log(JSON.stringify({ code: "CREATION_LANGUAGE_WORKER_READY", queue: CREATION_LANGUAGE_QUEUE_NAME, concurrency }));
async function shutdown() {
  if (stopping) return;
  stopping = true; clearInterval(timer);
  // The provider timeout is bounded at 180 seconds. Let an active request save
  // its result when the host grants a graceful shutdown; crash recovery still
  // refuses to repeat a request with a persisted submission marker.
  await worker.close();
  while (beating) await new Promise(resolve => setTimeout(resolve, 100));
  await connection.quit(); await prisma.$disconnect();
}
process.on("SIGTERM", () => void shutdown().catch(() => process.exitCode = 1));
process.on("SIGINT", () => void shutdown().catch(() => process.exitCode = 1));
