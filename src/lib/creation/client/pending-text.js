import { inspectHtml } from "../html/document.js";
import { serialize } from "parse5";
// Small recovery records, independent of the whole layout snapshot. No renderer
// or schema dependency is loaded for a keystroke.
export function pendingTextSnapshot(value) {
  if (value === null || value === undefined) return null;
  if (value.format === "html-source") {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(value.pageId || "") || ![value.original, value.text].every(text => typeof text === "string" && new TextEncoder().encode(text).length <= 160 * 1024)) throw new Error("TEXT_DRAFT_INVALID");
    return { format: "html-source", pageId: value.pageId, nodeId: "source", original: value.original, text: value.text, composing: false };
  }
  if (![value.pageId, value.nodeId].every(id => typeof id === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(id))
    || ![value.original, value.text].every(text => typeof text === "string" && text.length <= 16000)) throw new Error("TEXT_DRAFT_INVALID");
  return { pageId: value.pageId, nodeId: value.nodeId, original: value.original, text: value.text, composing: Boolean(value.composing) };
}

export function pendingTextOperations(content, input) {
  const draft = pendingTextSnapshot(input);
  if (!draft) return [];
  if (content?.schemaVersion === 3) {
    const page = content.pages.find(page => page.id === draft.pageId);
    if (!page) throw new Error("TEXT_EDIT_TARGET_CHANGED");
    if (draft.format === "html-source") {
      if (page.html !== draft.original && page.html !== draft.text) throw new Error("TEXT_EDIT_TARGET_CHANGED");
      return page.html === draft.text ? [] : [{ op: "setHtmlPage", pageId: page.id, html: inspectHtml(draft.text, { assignIds: true }).html }];
    }
    const parsed = inspectHtml(page.html), node = parsed.ids.get(draft.nodeId);
    if (!node || node.childNodes.some(child => child.nodeName !== "#text")) throw new Error("TEXT_EDIT_TARGET_CHANGED");
    const text = node.childNodes.map(child => child.value).join("");
    if (text !== draft.original && text !== draft.text) throw new Error("TEXT_EDIT_TARGET_CHANGED");
    if (text === draft.text) return [];
    node.childNodes = [{ nodeName: "#text", value: draft.text, parentNode: node }];
    return [{ op: "setHtmlPage", pageId: page.id, html: serialize(parsed.tree) }];
  }
  const node = content?.pages.find(page => page.id === draft.pageId)?.nodes.find(node => node.id === draft.nodeId);
  if (!node || node.type !== "text" || node.text !== draft.original && node.text !== draft.text) throw new Error("TEXT_EDIT_TARGET_CHANGED");
  if (node.text === draft.text) return [];
  if (node.locked) throw new Error("NODE_LOCKED");
  return [{ op: "setText", pageId: draft.pageId, nodeId: draft.nodeId, text: draft.text }];
}

export function createPendingTextJournal({ write, beforeClear, onError, onSaved, delay = 180, maxWait = 1000, snapshot = pendingTextSnapshot }) {
  let value = null, version = 0, savedVersion = 0, enqueuedVersion = 0, chain = Promise.resolve(), timer, firstDirtyAt = null;
  const flush = () => {
    clearTimeout(timer); timer = undefined;
    if (savedVersion === version || enqueuedVersion === version) return chain;
    const snapshot = value, target = version;
    firstDirtyAt = null;
    enqueuedVersion = target;
    const previous = chain;
    // Capture the old editor's operation write now. React Activity may tear
    // down/recreate effects and reset its model before the queued task runs.
    let clearing;
    try { clearing = snapshot === null ? Promise.resolve(beforeClear()) : Promise.resolve(); }
    catch (error) { clearing = Promise.reject(error); }
    clearing.catch(() => {});
    // write must register its storage queue slot immediately, before awaiting
    // prepare. This preserves ordering against reads from a remounted editor.
    const prepare = async () => {
      await previous.catch(() => {});
      await clearing;
    };
    let writing;
    try { writing = write(snapshot, prepare); } catch (error) { writing = Promise.reject(error); }
    const task = Promise.resolve(writing).then(() => {
      savedVersion = target;
      onSaved?.(target === version);
    });
    chain = task.catch(error => { if (enqueuedVersion === target) enqueuedVersion = savedVersion; throw error; });
    return chain;
  };
  const schedule = () => {
    clearTimeout(timer);
    firstDirtyAt ??= Date.now();
    timer = setTimeout(() => { void flush().catch(onError); }, Math.max(0, Math.min(delay, maxWait - (Date.now() - firstDirtyAt))));
  };
  return {
    seed(input) { if (version === 0) value = snapshot(input); },
    change(input) {
      value = snapshot(input); version++;
      schedule();
    },
    flush,
    snapshot: () => value,
    dirty: () => savedVersion !== version,
    close() { clearTimeout(timer); return flush(); },
  };
}
