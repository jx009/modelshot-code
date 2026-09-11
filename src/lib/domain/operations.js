import { prisma } from "../prisma.js";

export async function operationalSnapshot(db = prisma, now = new Date()) {
  const [queued, oldest, outbox, outboxOldest, unknown, staleReservations, paymentErrors, exportErrors, worker, reviews] = await Promise.all([
    db.tryOn.count({ where: { status: "queued" } }),
    db.tryOn.findFirst({ where: { status: "queued" }, orderBy: { createTime: "asc" }, select: { createTime: true } }),
    db.outboxEvent.count({ where: { deliveredAt: null } }),
    db.outboxEvent.findFirst({ where: { deliveredAt: null }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    db.tryOn.count({ where: { status: "reconciling" } }),
    db.creditReservation.count({ where: { state: "held", createdAt: { lt: new Date(+now - 30 * 60_000) } } }),
    db.paymentEvent.count({ where: { state: "error" } }),
    db.exportJob.count({ where: { status: "failed" } }),
    db.serviceHeartbeat.findUnique({ where: { id: "worker" } }),
    db.order.count({ where: { manualReview: true } }),
  ]);
  const metrics = { queued, oldestQueueSeconds: oldest ? Math.floor((+now - oldest.createTime) / 1000) : 0, outbox, outboxDelaySeconds: outboxOldest ? Math.floor((+now - outboxOldest.createdAt) / 1000) : 0, unknown, staleReservations, paymentErrors, exportErrors, reviews, workerAgeSeconds: worker ? Math.floor((+now - worker.updatedAt) / 1000) : null };
  const alerts = [];
  if (metrics.workerAgeSeconds === null || metrics.workerAgeSeconds > 60) alerts.push("WORKER_STALE");
  if (metrics.oldestQueueSeconds > 120 || queued > 100) alerts.push("QUEUE_BACKLOG");
  if (metrics.outboxDelaySeconds > 30) alerts.push("OUTBOX_DELAY");
  if (unknown) alerts.push("PROVIDER_UNKNOWN");
  if (staleReservations) alerts.push("RESERVATIONS_STALE");
  if (paymentErrors) alerts.push("PAYMENT_ERRORS");
  return { metrics, alerts, at: now.toISOString() };
}
