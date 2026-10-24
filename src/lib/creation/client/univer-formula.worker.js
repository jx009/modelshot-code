import { createUniver } from "@univerjs/presets";
import { UniverSheetsCoreWorkerPreset } from "@univerjs/preset-sheets-core/worker";
import { observeNativeFormulaBudget } from "./native-formula-budget.js";

// The browser Worker owns this engine until termination by its editor lease.
// No UI/CSS or application credentials are imported into the formula worker.
const { univerAPI } = createUniver({ presets: [UniverSheetsCoreWorkerPreset()], undoRedoHistoryLimit: 0 });
observeNativeFormulaBudget(univerAPI, value => globalThis.postMessage(value));
globalThis.postMessage({ type: "modelshot-univer-formula-ready-1" });
