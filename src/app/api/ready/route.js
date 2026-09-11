import Redis from "ioredis";
import { prisma } from "../../../lib/prisma.js";
import { objectStorage } from "../../../lib/infra/storage/s3.js";
import { validateEnvironment } from "../../../lib/infra/environment.js";

export async function GET() {
  let redis;
  try {
    validateEnvironment();
    redis = new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 0, connectTimeout: 2000, commandTimeout: 2000, retryStrategy: () => null });
    redis.on("error", () => {});
    await Promise.all([prisma.$queryRaw`SELECT 1`, redis.ping(), objectStorage().health()]);
    const worker = await prisma.serviceHeartbeat.findUnique({ where: { id: "worker" } });
    if (!worker || Date.now() - worker.updatedAt > 60_000) throw new Error("Worker stale");
    return Response.json({ status: "ready" }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
  finally { redis?.disconnect(); }
}
