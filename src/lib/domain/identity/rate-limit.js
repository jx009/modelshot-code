import { createHash } from "node:crypto";
import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";

export async function rateLimit(scope, identity, max, seconds, db = prisma) {
  const window = Math.floor(Date.now() / (seconds * 1000));
  const key = createHash("sha256").update(`${scope}:${identity}:${window}`).digest("hex");
  const row = await db.rateLimit.upsert({
    where: { key },
    create: { key, expiresAt: new Date((window + 1) * seconds * 1000) },
    update: { hits: { increment: 1 } },
  });
  if (row.hits > max) throw new AppError("RATE_LIMITED", 429, true);
}
