import { createHash } from "node:crypto";
import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";

export async function rateLimit(scope, identity, max, seconds, db = prisma, code = "RATE_LIMITED") {
  const window = Math.floor(Date.now() / (seconds * 1000));
  const key = createHash("sha256").update(`${scope}:${identity}:${window}`).digest("hex");
  const row = await db.rateLimit.upsert({
    where: { key },
    create: { key, expiresAt: new Date((window + 1) * seconds * 1000) },
    update: { hits: { increment: 1 } },
  });
  if (row.hits > max) {
    const error = new AppError(code, 429, true);
    error.retryAfter = Math.max(1, Math.ceil((row.expiresAt.getTime() - Date.now()) / 1000));
    throw error;
  }
}
