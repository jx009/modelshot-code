import { NATIVE_FORMULA_BUDGET_EVENT } from "./native-formula-budget.js";

const READY = "modelshot-univer-formula-ready-1";
// Univer accepts a Worker instance but deliberately does not terminate a
// caller-owned worker. This lease owns startup, failure and final termination.
export function createNativeFormulaWorker({ signal, onError, timeoutMs = 15000, calculationTimeoutMs = 10000,
  createWorker = () => new Worker(new URL("./univer-formula.worker.js", import.meta.url), { type: "module", name: "creation-formula" }),
} = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    let worker;
    try { worker = createWorker(); } catch (error) { reject(error); return; }
    let stopped = false, ready = false, calculationTimer = null;
    const dispose = () => {
      if (stopped) return;
      stopped = true; clearTimeout(timer); clearTimeout(calculationTimer); calculationTimer = null;
      signal?.removeEventListener("abort", aborted);
      worker.removeEventListener("message", message);
      worker.removeEventListener("error", failed); worker.removeEventListener("messageerror", failed);
      worker.terminate();
      if (!ready) reject(new Error("ARTIFACT_CLOSED"));
    };
    const failed = () => {
      if (stopped) return;
      const error = new Error("NATIVE_OFFICE_WORKER_FAILED");
      if (!ready) reject(error);
      dispose(); if (ready) onError?.(error);
    };
    const aborted = () => { if (!ready) reject(signal.reason); dispose(); };
    const message = event => {
      if (stopped) return;
      if (!ready && event.data?.type === READY) {
        ready = true; clearTimeout(timer); resolve({ worker, dispose }); return;
      }
      if (!ready || event.data?.type !== NATIVE_FORMULA_BUDGET_EVENT) return;
      if (event.data.active === false) { clearTimeout(calculationTimer); calculationTimer = null; }
      else if (event.data.active === true && calculationTimer === null) calculationTimer = setTimeout(() => {
        if (stopped) return;
        dispose(); onError?.(new Error("NATIVE_OFFICE_CALCULATION_TIMEOUT"));
      }, calculationTimeoutMs);
    };
    const timer = setTimeout(() => { reject(new Error("NATIVE_OFFICE_WORKER_TIMEOUT")); dispose(); }, timeoutMs);
    worker.addEventListener("message", message);
    worker.addEventListener("error", failed); worker.addEventListener("messageerror", failed);
    signal?.addEventListener("abort", aborted, { once: true });
    if (signal?.aborted) aborted();
  });
}
