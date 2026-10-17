import { createHash } from "node:crypto";

/** Full snapshots make reconnect safe even when a proxy drops intermediate events. */
export function jobEvent(rows) {
  const data = JSON.stringify(rows);
  const id = createHash("sha256").update(data).digest("hex").slice(0, 24);
  return { id, frame: `id: ${id}\nevent: jobs\ndata: ${data}\n\n` };
}

export function createJobStream(read, signal, { interval = 2000, lifetime = 45000 } = {}) {
  let timer, stopped = false, stop;
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      let previous, ticks = 0;
      const started = Date.now();
      stop = (close = true) => { if (stopped) return; stopped = true; clearTimeout(timer); signal?.removeEventListener("abort", stop); if (close) controller.close(); };
      signal?.addEventListener("abort", stop, { once: true });
      if (signal?.aborted) { stop(); return; }
      async function tick() {
        try {
          const rows = await read();
          if (stopped) return;
          const event = jobEvent(rows);
          if (event.id !== previous) { controller.enqueue(encoder.encode(event.frame)); previous = event.id; }
          else if (++ticks % 5 === 0) controller.enqueue(encoder.encode(": heartbeat\n\n"));
          if (Date.now() - started >= lifetime) { stop(); return; }
          timer = setTimeout(tick, interval);
        } catch { stop(); }
      }
      controller.enqueue(encoder.encode("retry: 2000\n\n"));
      void tick();
    },
    cancel() { stop?.(false); },
  });
}
