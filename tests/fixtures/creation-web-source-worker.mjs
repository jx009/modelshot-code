import { parentPort } from "node:worker_threads";

// Adapt only browser messaging. Execute the actual production worker module
// in a real separate JS thread; there is no DOM, window or application API.
globalThis.self = { postMessage: message => parentPort.postMessage(message), onmessage: null };
await import("../../src/workers/creation-web-source.worker.js");
parentPort.on("message", data => { void self.onmessage({ data }); });
