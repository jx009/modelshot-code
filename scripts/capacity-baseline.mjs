import os from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { domainFixture } from "../tests/support/domain-fixture.mjs";
import { submitGeneration } from "../src/lib/domain/generation/submission.js";
import { cancelOutput } from "../src/lib/domain/generation/execution.js";
import { reconcileLedger } from "../src/lib/domain/billing/reconciliation.js";

const f = await domainFixture();
try {
  const user = await f.user(1800), quote = await f.quote(user);
  const started = performance.now();
  const latencies = await Promise.all(Array.from({ length: 20 }, async () => { const start = performance.now(); const result = await submitGeneration(user.id, quote.quoteId, quote.digest, "capacity-fixed-idempotency", f.db); return { duration: performance.now() - start, id: result.tryonId }; }));
  const values = latencies.map(row => row.duration).sort((a, b) => a - b);
  const batches = await f.db.batchJob.count({ where: { userId: user.id } });
  const distinct = new Set(latencies.map(row => row.id)).size;
  if (batches !== 1 || distinct !== 1) throw new Error("Duplicate submission at capacity");
  await cancelOutput(user.id, latencies[0].id, f.db);
  const quotes = await Promise.all(Array.from({ length: 20 }, () => f.quote(user)));
  const uniqueStarted = performance.now();
  const jobs = await Promise.all(quotes.map(q => submitGeneration(user.id, q.quoteId, q.digest, randomUUID(), f.db)));
  const uniqueElapsedMs = performance.now() - uniqueStarted;
  for (const job of jobs) await cancelOutput(user.id, job.tryonId, f.db);
  if (!(await reconcileLedger(f.db)).ok) throw new Error("Ledger invariant failed");
  const report = { at: new Date().toISOString(), cpu: os.cpus()[0].model, logicalCores: os.cpus().length, memoryGiB: Math.round(os.totalmem() / 2 ** 30), node: process.version, concurrency: 20, duplicateSubmission: { batches, p50Ms: values[9], p95Ms: values[18], maxMs: values[19] }, uniqueSubmissions: { count: 20, elapsedMs: uniqueElapsedMs }, elapsedMs: performance.now() - started, scope: "Local PostgreSQL submission services; supplier throughput excluded" };
  await mkdir("test-results", { recursive: true }); await writeFile("test-results/capacity-baseline.json", JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await f.cleanup(); }
