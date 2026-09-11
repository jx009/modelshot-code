import { prisma } from "../../prisma.js";
import { recoverLeases } from "./execution.js";

export async function recoverWork(db = prisma, now = new Date()) {
  const generation = await recoverLeases(db);
  const outputs = await db.tryOn.findMany({ where: { status: "succeeded", OR: [{ exportStatus: "pending" }, { qaStatus: "pending" }] }, take: 200 });
  const exports = await db.exportJob.findMany({ where: { status: { in: ["queued", "running"] } }, take: 100 });
  const payments = await db.paymentEvent.findMany({ where: { state: { in: ["pending", "error"] }, attempts: { lt: 20 } }, take: 100 });
  const refunds = await db.refundRequest.findMany({ where: { status: "pending" }, take: 100 });
  const subscriptions = await db.subscriptionChange.findMany({ where: { state: "pending" }, take: 100 });
  const events = [
    ...outputs.flatMap(row => [row.exportStatus === "pending" && { kind: "delivery", entityId: row.id }, row.qaStatus === "pending" && { kind: "qa", entityId: row.id }].filter(Boolean)),
    ...exports.map(row => ({ kind: "export", entityId: row.id })),
    ...payments.map(row => ({ kind: "payment", entityId: row.id })),
    ...refunds.map(row => ({ kind: "refund", entityId: row.id })),
    ...subscriptions.map(row => ({ kind: "subscription", entityId: row.id })),
  ];
  if (events.length) await db.outboxEvent.createMany({ data: events.map(event => ({ ...event, businessKey: `recover:${event.kind}:${event.entityId}:${Math.floor(+now / 60_000)}` })), skipDuplicates: true });
  return { generation, stages: events.length };
}
