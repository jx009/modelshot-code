import * as library from "@univerjs/presets";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import { IEditorBridgeService } from "@univerjs/sheets-ui";
import { IUniverInstanceService, UniverInstanceType } from "@univerjs/core";
import "@univerjs/preset-sheets-core/lib/index.css";
import { startNativeOfficeEngine } from "./native-office-engine.js";
import { createNativeFormulaWorker } from "./univer-worker-lifetime.js";
import { readNativeSheetInput } from "./native-sheet-input.js";

export async function mount(options) {
  options.signal?.throwIfAborted();
  const locale = options.locale === "en" ? "enUS" : "zhCN";
  const pack = locale === "enUS" ? await import("@univerjs/preset-sheets-core/locales/en-US") : await import("@univerjs/preset-sheets-core/locales/zh-CN");
  options.signal?.throwIfAborted();
  const workerLease = await createNativeFormulaWorker({ signal: options.signal, onError: options.onError });
  return startNativeOfficeEngine({ ...options, library, preset: UniverSheetsCorePreset, kind: "sheet", locale, localePack: pack.default, workerLease,
    readPendingInput: (engine, { composing }) => {
      const injector = engine.__getInjector();
      return readNativeSheetInput({ bridge: injector.get(IEditorBridgeService), instances: injector.get(IUniverInstanceService), documentType: UniverInstanceType.UNIVER_DOC, unitId: options.snapshot.id, composing });
    },
  });
}
