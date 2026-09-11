import { prisma } from "../../prisma.js";

export async function reconcileLedger(db = prisma) {
  // One snapshot prevents concurrent settlement from looking like an imbalance.
  return db.$transaction(async tx => {
    const cycles = await tx.$queryRaw`SELECT c.id FROM "BillingCycle" c WHERE c.reserved <> (SELECT COALESCE(SUM(r.amount),0) FROM "CreditReservation" r WHERE r."cycleId"=c.id AND r.state='held')`;
    const users = await tx.$queryRaw`SELECT u.id FROM "User" u WHERE u.credits < (SELECT COALESCE(SUM(r.amount),0) FROM "CreditReservation" r WHERE r."userId"=u.id AND r.state='held' AND r.channel='credits') OR u.credits < (SELECT COALESCE(SUM(l.remaining),0) FROM "CreditLot" l WHERE l."userId"=u.id)`;
    const outputs = await tx.$queryRaw`SELECT t.id FROM "TryOn" t JOIN "CreditReservation" r ON r."tryOnId"=t.id WHERE (t.status='succeeded' AND r.state <> 'captured') OR (t.status IN ('failed','cancelled') AND r.state <> 'released')`;
    const sources = await tx.$queryRaw`SELECT r.id FROM "CreditReservation" r LEFT JOIN "CreditTransaction" t ON t.id=r."sourceTransactionId" WHERE r.state='captured' AND (t.id IS NULL OR t."tryOnId" <> r."tryOnId" OR t.amount <> -r.amount)`;
    const issues = { cycles: cycles.map(r => r.id), users: users.map(r => r.id), outputs: outputs.map(r => r.id), sources: sources.map(r => r.id) };
    return { ok: Object.values(issues).every(rows => !rows.length), issues };
  }, { isolationLevel: "RepeatableRead" });
}
