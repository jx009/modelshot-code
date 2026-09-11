import { z } from "zod";
import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";
import { digestJson } from "../generation/contracts.js";
import { reserveCreditLots } from "../billing/ledger.js";

const LEVEL = { user: 0, agent: 1, admin: 2, root: 3 };
export const adminUserSchema = z.object({
  id: z.string().min(1).max(128), role: z.enum(["user", "agent", "admin", "root"]).optional(),
  status: z.enum(["active", "banned"]).optional(), creditsDelta: z.number().int().min(-100000).max(100000).optional(),
  reason: z.string().trim().min(3).max(500),
}).strict();

export async function administerUser(adminId, input, key, db = prisma) {
  const data = adminUserSchema.parse(input);
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(key || "")) throw new AppError("IDEMPOTENCY_KEY_REQUIRED");
  return db.$transaction(async tx => {
    // Deterministic ordering prevents two administrators deadlocking each other.
    for (const id of [...new Set([adminId, data.id])].sort()) await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${id} FOR UPDATE`;
    const actor = await tx.user.findUnique({ where: { id: adminId } });
    const target = await tx.user.findUnique({ where: { id: data.id } });
    if (!actor || actor.status !== "active" || LEVEL[actor.role] < 2 || !target || LEVEL[target.role] >= LEVEL[actor.role] || adminId === data.id) throw new AppError("ADMIN_SCOPE_DENIED", 403);
    if (data.role && (actor.role !== "root" || data.role === "root")) throw new AppError("ADMIN_ROLE_DENIED", 403);
    const businessKey = `admin:${adminId}:${key}`;
    const digest = digestJson(data);
    const old = await tx.adminAuditLog.findUnique({ where: { businessKey } });
    if (old) {
      if (old.digest !== digest) throw new AppError("IDEMPOTENCY_CONFLICT", 409);
      return { ok: true };
    }
    const delta = data.creditsDelta || 0;
    if (delta < 0) {
      const allocations = await reserveCreditLots(tx, target, -delta);
      for (const allocation of allocations) await tx.creditLot.update({ where: { id: allocation.lotId }, data: { remaining: { decrement: allocation.amount }, reserved: { decrement: allocation.amount } } });
    }
    await tx.user.update({ where: { id: target.id }, data: {
      ...(data.role ? { role: data.role } : {}), ...(data.status ? { status: data.status } : {}),
      ...(data.role || data.status ? { sessionVersion: { increment: 1 } } : {}), credits: { increment: delta },
    } });
    if (delta) await tx.creditTransaction.create({ data: { userId: target.id, type: "adjustment", channel: "credits", amount: delta, reason: data.reason, businessKey } });
    if (delta > 0) await tx.creditLot.create({ data: { userId: target.id, remaining: delta } });
    await tx.adminAuditLog.create({ data: { adminId, action: "UPDATE_USER", targetUserId: target.id, businessKey, digest,
      detail: JSON.stringify({ before: { role: target.role, status: target.status, credits: target.credits }, after: data }) } });
    return { ok: true };
  });
}
