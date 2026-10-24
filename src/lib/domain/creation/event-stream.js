import { prisma } from "../../prisma.js";
import { subscribeRun } from "./event-hub.js";
import { RUN_ACTIVE } from "../../creation/contracts/runs.js";

export function createRunStream(userId, runId, after, signal, { db = prisma, subscribe = subscribeRun, lifetime = 60000 } = {}) {
  let stop;
  return new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false, cursor = after, reading = false, dirty = false, unsubscribe, heartbeat, deadline;
      const send = text => {
        if (closed) return false;
        // A stalled consumer cannot accumulate unbounded event buffers.
        if (controller.desiredSize !== null && controller.desiredSize < -65536) { stop(); return false; }
        controller.enqueue(encoder.encode(text));
        return true;
      };
      stop = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat); clearTimeout(deadline); unsubscribe?.();
        signal?.removeEventListener("abort", stop);
        try { controller.close(); } catch { /* consumer cancelled */ }
      };
      async function catchUp() {
        if (closed) return;
        if (reading) { dirty = true; return; }
        reading = true;
        try {
          const run = await db.creationRun.findFirst({ where: { id: runId, userId }, select: { eventSequence: true, status: true } });
          if (closed) return;
          if (!run) { stop(); return; }
          const rows = await db.creationEvent.findMany({ where: { runId, sequence: { gt: cursor, lte: run.eventSequence } }, orderBy: { sequence: "asc" }, take: 100 });
          if (closed) return;
          if (cursor > run.eventSequence || rows.length && rows[0].sequence !== cursor + 1 || !rows.length && cursor < run.eventSequence) {
            // Retention or an invalid cursor: client must replace state from a
            // fresh authenticated snapshot instead of silently skipping events.
            send(`event: reset\ndata: ${JSON.stringify({ sequence: run.eventSequence })}\n\n`);
            stop(); return;
          }
          for (const row of rows) {
            if (!send(`id: ${row.sequence}\nevent: creation\ndata: ${JSON.stringify({ sequence: row.sequence, type: row.type, payload: row.payload })}\n\n`)) return;
            cursor = row.sequence;
          }
          if (cursor < run.eventSequence) dirty = true;
          else if (!RUN_ACTIVE.includes(run.status)) {
            send(`event: settled\ndata: ${JSON.stringify({ sequence: cursor, status: run.status })}\n\n`);
            stop();
          }
        } catch { stop(); }
        finally {
          reading = false;
          if (dirty && !closed) { dirty = false; void catchUp(); }
        }
      }
      signal?.addEventListener("abort", stop, { once: true });
      if (signal?.aborted) { stop(); return; }
      send("retry: 4000\n\n");
      // Subscribe before replay. Concurrent notifications mark the replay dirty.
      try { unsubscribe = subscribe(userId, runId, state => { if (state.missing || state.unavailable) stop(); else void catchUp(); }); }
      catch { stop(); return; }
      heartbeat = setInterval(() => send(": heartbeat\n\n"), 15000);
      deadline = setTimeout(stop, lifetime);
      void catchUp();
    },
    cancel() { stop?.(); },
  }, { highWaterMark: 65536, size: chunk => chunk.byteLength });
}
