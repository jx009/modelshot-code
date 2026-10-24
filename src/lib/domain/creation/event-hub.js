import { prisma } from "../../prisma.js";
import { queueConnection } from "../../infra/queue/index.js";

// One lazy Redis subscriber per Web process. Multiple tabs for the same owned
// run share one bounded DB read; heartbeats never trigger database queries.
const channels = new Map();
let subscriber, cleanupTimer;
const CHANNEL = "modelshot:creation:events";
function connect() {
  clearTimeout(cleanupTimer);
  if (subscriber) return;
  subscriber = queueConnection();
  subscriber.on("error", () => {}); // Durable catch-up remains available.
  subscriber.on("message", (_channel, runId) => {
    for (const entry of channels.values()) if (entry.runId === runId) void refresh(entry);
  });
  void subscriber.subscribe(CHANNEL).catch(() => {});
}

async function refresh(entry) {
  if (!channels.has(entry.key)) return;
  if (entry.pending) { entry.again = true; return; }
  entry.pending = true;
  try {
    const run = await prisma.creationRun.findFirst({ where: { id: entry.runId, userId: entry.userId },
      select: { eventSequence: true, status: true },
    });
    if (!run) { for (const listener of entry.listeners) listener({ missing: true }); return; }
    if (run.eventSequence !== entry.sequence) {
      entry.sequence = run.eventSequence;
      for (const listener of entry.listeners) listener({ sequence: run.eventSequence, status: run.status });
    }
  } catch {
    for (const listener of entry.listeners) listener({ unavailable: true });
  } finally {
    entry.pending = false;
    if (entry.again) { entry.again = false; void refresh(entry); }
  }
}

export function subscribeRun(userId, runId, listener) {
  connect();
  const key = `${userId}:${runId}`;
  let entry = channels.get(key);
  if (!entry) {
    entry = { key, userId, runId, sequence: -1, listeners: new Set(), pending: false, again: false };
    channels.set(key, entry);
    entry.timer = setInterval(() => void refresh(entry), 15000);
    entry.timer.unref?.();
  }
  entry.listeners.add(listener);
  void refresh(entry);
  return () => {
    entry.listeners.delete(listener);
    if (!entry.listeners.size) { clearInterval(entry.timer); channels.delete(key); }
    if (!channels.size) {
      cleanupTimer = setTimeout(() => { if (!channels.size) { subscriber?.disconnect(); subscriber = undefined; } }, 5000);
      cleanupTimer.unref?.();
    }
  };
}
