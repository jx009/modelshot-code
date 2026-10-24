import { createWebVisualSource } from "../lib/creation/web-visual-source.js";
import { prepareWebRename } from "../lib/creation/client/web-rename.js";
import { prepareWebImageInsertion } from "../lib/creation/client/web-image-insert.js";
import { assertLayoutJournalCapacity } from "../lib/creation/layout-journal.js";
import { sourceTaskPayload, WEB_SOURCE_CHANNEL } from "../lib/creation/web-source-protocol.js";

let used = false;
self.onmessage = async event => {
  if (used) return;
  used = true;
  const message = event.data;
  if (!message || message.channel !== WEB_SOURCE_CHANNEL || !Number.isSafeInteger(message.id) || message.id < 1) return;
  const { type, id } = message;
  try {
    const payload = sourceTaskPayload(type, message.payload);
    let result;
    if (type === "visual") result = createWebVisualSource(payload.source);
    else if (type === "rename") result = await prepareWebRename(payload.content, payload.request, { yieldControl: async () => {} });
    else result = prepareWebImageInsertion(payload.content, payload.target, payload.page);
    if (result.operations?.length) assertLayoutJournalCapacity([], result.operations);
    self.postMessage({ channel: WEB_SOURCE_CHANNEL, id, type, ok: true, result });
  } catch (failure) {
    const code = /^(?:WEB|LAYOUT|ARTIFACT)_[A-Z_]+$/.test(failure?.message || "") ? failure.message : "WEB_SOURCE_WORKER_FAILED";
    self.postMessage({ channel: WEB_SOURCE_CHANNEL, id, type, ok: false, error: code });
  }
};
