import * as library from "@univerjs/presets";
import { UniverDocsCorePreset } from "@univerjs/preset-docs-core";
import { DocSelectionManagerService } from "@univerjs/docs";
import "@univerjs/preset-docs-core/lib/index.css";
import { startNativeOfficeEngine } from "./native-office-engine.js";
import { readNativeDocumentSelection } from "./native-document-selection.js";

export async function mount(options) {
  options.signal?.throwIfAborted();
  const locale = options.locale === "en" ? "enUS" : "zhCN";
  const pack = locale === "enUS" ? await import("@univerjs/preset-docs-core/locales/en-US") : await import("@univerjs/preset-docs-core/locales/zh-CN");
  options.signal?.throwIfAborted();
  return startNativeOfficeEngine({ ...options, library, preset: UniverDocsCorePreset, kind: "document", locale, localePack: pack.default,
    readDocumentSelection: engine => {
      // The docs facade exposes setSelection, but not the current selection.
      // Pin this adapter to 1.2.0's exported service; never subscribe globally.
      const service = engine.__getInjector().get(DocSelectionManagerService);
      return readNativeDocumentSelection(service, options.snapshot.id);
    },
  });
}
