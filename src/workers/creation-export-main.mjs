import "dotenv/config";
import { Worker } from "bullmq";
import { prisma } from "../lib/prisma.js";
import { queueConnection, CREATION_EXPORT_QUEUE_NAME } from "../lib/infra/queue/index.js";
import { executeArtifactExport, recoverArtifactExports } from "../lib/domain/creation/export-execution.js";
import { EXPORTER_VERSION, exportFormat } from "../lib/creation/contracts/exports.js";
import { probeRasterInProcess } from "../lib/domain/creation/export-process.js";
import { executeOfficeImport, recoverOfficeImports, OFFICE_IMPORT_VERSION } from "../lib/domain/creation/office-imports.js";

// Deployment must run this entrypoint in its own resource-limited container or
// machine, never in the web/payment worker. This explicit guard is an operator
// assertion, not proof that cgroup/CPU/disk limits have been configured.
if (process.env.CREATION_EXPORT_ISOLATED !== "true") throw new Error("CREATION_EXPORT_ISOLATED must be explicitly enabled on the isolated export host");
const exporters = { pptx: EXPORTER_VERSION };
if (process.env.CREATION_HTML_RUNTIME === "true") {
  await probeRasterInProcess({ html: true });
  for (const format of ["png", "jpeg", "pdf", "pptx"]) {
    const descriptor = exportFormat(format, 3, format === "pptx" ? "slides" : "poster"); exporters[descriptor.workerKey] = descriptor.version;
  }
}
if (process.env.CREATION_RASTER_RUNTIME === "true") {
  // Fail startup on missing native renderer/fonts; never advertise a format
  // that this deployment cannot render. The main worker stays free of Skia.
  await probeRasterInProcess();
  exporters.png = exportFormat("png").version; exporters.jpeg = exportFormat("jpeg").version;
  exporters.svg = exportFormat("svg").version;
}
if (process.env.CREATION_PDF_RUNTIME === "true") {
  // Probe the actual native multi-page/vector encoder before advertising PDF.
  await probeRasterInProcess({ pdf: true });
  exporters.pdf = exportFormat("pdf").version;
}
const connection = queueConnection(), abort = new AbortController();
const worker = new Worker(CREATION_EXPORT_QUEUE_NAME, async job => {
  if (!["creation-export", "creation-import"].includes(job.name) || job.data.version !== 1 || typeof job.data.id !== "string") throw new Error("Unsupported conversion payload");
  await (job.name === "creation-import" ? executeOfficeImport : executeArtifactExport)(job.data.id, { signal: abort.signal });
}, { connection, concurrency: 1 });
worker.on("error", () => console.error(JSON.stringify({ code: "CREATION_EXPORT_WORKER_ERROR" })));
worker.on("failed", job => console.error(JSON.stringify({ code: "CREATION_EXPORT_RETRY", exportId: job?.data?.id })));
connection.on("error", () => console.error(JSON.stringify({ code: "CREATION_EXPORT_REDIS_UNAVAILABLE" })));
let stopping = false, recovering = false;
async function tick() {
  if (stopping || recovering) return;
  recovering = true;
  try {
    await recoverArtifactExports();
    await recoverOfficeImports();
    await prisma.serviceHeartbeat.upsert({ where: { id: "creation-export-worker" },
      create: { id: "creation-export-worker", details: { queue: CREATION_EXPORT_QUEUE_NAME, concurrency: 1, exporterVersion: EXPORTER_VERSION, exporters, importer: OFFICE_IMPORT_VERSION } },
      update: { updatedAt: new Date(), details: { queue: CREATION_EXPORT_QUEUE_NAME, concurrency: 1, exporterVersion: EXPORTER_VERSION, exporters, importer: OFFICE_IMPORT_VERSION } } });
  } catch { console.error(JSON.stringify({ code: "CREATION_EXPORT_RECOVERY_FAILED" })); }
  finally { recovering = false; }
}
await tick();
const timer = setInterval(tick, 30000);
console.log(JSON.stringify({ code: "CREATION_EXPORT_WORKER_READY", queue: CREATION_EXPORT_QUEUE_NAME }));
async function shutdown() {
  if (stopping) return;
  stopping = true; clearInterval(timer); abort.abort();
  await worker.close();
  while (recovering) await new Promise(resolve => setTimeout(resolve, 100));
  await connection.quit(); await prisma.$disconnect();
}
process.on("SIGTERM", () => void shutdown().catch(() => process.exitCode = 1));
process.on("SIGINT", () => void shutdown().catch(() => process.exitCode = 1));
