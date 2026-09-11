import { prisma } from "../../prisma.js";

export async function claimStep(entityId, kind, db = prisma) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`step:${entityId}:${kind}`}, 0))::text`;
    const old = await tx.processingStep.findUnique({ where: { entityId_kind: { entityId, kind } } });
    if (old?.state === "done" || old?.state === "cancelled" || old?.leaseUntil > new Date()) return null;
    return tx.processingStep.upsert({ where: { entityId_kind: { entityId, kind } },
      create: { entityId, kind, state: "running", fence: 1, leaseUntil: new Date(Date.now() + 120_000) },
      update: { state: "running", fence: { increment: 1 }, leaseUntil: new Date(Date.now() + 120_000), errorCode: null } });
  });
}

export async function completeStep(step, data, mutate, db = prisma) {
  return db.$transaction(async tx => {
    const changed = await tx.processingStep.updateMany({ where: { id: step.id, fence: step.fence, state: "running" }, data: { ...data, leaseUntil: null } });
    if (!changed.count) return false;
    if (mutate) await mutate(tx);
    return true;
  });
}
