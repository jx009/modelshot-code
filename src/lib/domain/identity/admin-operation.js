import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";
import { digestJson } from "../generation/contracts.js";

export async function auditedOperation(adminId, key, action, input, mutate, db = prisma, minRole = "admin") {
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(key || "")) throw new AppError("IDEMPOTENCY_KEY_REQUIRED");
  if (typeof input.reason !== "string" || input.reason.trim().length < 3 || input.reason.length > 500) throw new AppError("REASON_REQUIRED");
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${adminId} FOR UPDATE`;
    const actor = await tx.user.findUnique({ where: { id: adminId } });
    if (!actor || actor.status !== "active" || !["root", ...(minRole === "admin" ? ["admin"] : [])].includes(actor.role)) throw new AppError("ADMIN_SCOPE_DENIED", 403);
    const businessKey = `operation:${adminId}:${key}`;
    const digest = digestJson({ action, input });
    const old = await tx.adminAuditLog.findUnique({ where: { businessKey } });
    if (old) {
      if (old.digest !== digest) throw new AppError("IDEMPOTENCY_CONFLICT", 409);
      return { ok: true, replayed: true };
    }
    const result = await mutate(tx, actor);
    // Mutators provide a redacted record; secrets must never enter the audit JSON.
    await tx.adminAuditLog.create({ data: { adminId, action, businessKey, digest, detail: JSON.stringify({ reason: input.reason, ...result?.audit }) } });
    return { ok: true, ...result?.response };
  }, { timeout: 15000 });
}
