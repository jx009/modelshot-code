// Separate transfer/CPU pressure from model requests waiting on a remote service.
export class ConcurrencyGate {
  constructor(limit) { this.limit = limit; this.active = 0; this.waiting = []; }
  setLimit(limit) { this.limit = limit; this.drain(); }
  drain() { while (this.active < this.limit && this.waiting.length) { this.active++; this.waiting.shift()(); } }
  async run(fn) {
    await new Promise(resolve => { this.waiting.push(resolve); this.drain(); });
    try { return await fn(); } finally { this.active--; this.drain(); }
  }
}
export const imageTransfers = new ConcurrencyGate(8);
export const imageProcessing = new ConcurrencyGate(4);
