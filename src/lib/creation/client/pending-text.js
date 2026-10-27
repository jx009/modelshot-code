import { inspectHtml, walkHtml } from "../html/document.js";
import { serialize } from "parse5";
import { inlineTextTags, textRootTags } from "../html/text-tags.js";

function textObject(markup, id, tag) {
  // Table cells need their parsing context or the HTML parser drops the root.
  const wrapped = ["td", "th"].includes(tag) ? `<table><tbody><tr>${markup}</tr></tbody></table>` : tag === "caption" ? `<table>${markup}</table>` : markup;
  const parsed = inspectHtml(wrapped, { allowEmpty: true }), root = parsed.ids.get(id);
  if (!root || root.tagName !== tag || !textRootTags.has(tag)) throw new Error("TEXT_EDIT_TARGET_CHANGED");
  const ancestors = new Set(); for (let parent = root.parentNode; parent; parent = parent.parentNode) ancestors.add(parent);
  walkHtml(parsed.tree, node => {
    if (node === root || ancestors.has(node)) return;
    let parent = node.parentNode; while (parent && parent !== root) parent = parent.parentNode;
    if (!parent && (node.tagName && node.tagName !== "head" || node.nodeName === "#text" && node.value.trim())
      || parent && node.tagName && !inlineTextTags.has(node.tagName)) throw new Error("TEXT_EDIT_TARGET_CHANGED");
  });
  return root;
}
function comparableText(node, root = node) {
  // Descendant IDs are regenerated after formatting ranges. They are identity
  // bookkeeping, not a content conflict when replaying an already saved draft.
  return JSON.stringify([node.nodeName, node.value ?? node.data ?? null, (node.attrs || [])
    .filter(attribute => node === root || attribute.name !== "data-node-id")
    .map(attribute => [attribute.name, attribute.value]).sort(), (node.childNodes || []).map(child => comparableText(child, root))]);
}
// Small recovery records, independent of the whole layout snapshot. No renderer
// or schema dependency is loaded for a keystroke.
export function pendingTextSnapshot(value) {
  if (value === null || value === undefined) return null;
  if (value.format === "html-source") {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(value.pageId || "") || ![value.original, value.text].every(text => typeof text === "string" && new TextEncoder().encode(text).length <= 160 * 1024)) throw new Error("TEXT_DRAFT_INVALID");
    return { format: "html-source", pageId: value.pageId, nodeId: "source", original: value.original, text: value.text, composing: false };
  }
  if (value.format === "html-text") {
    if (![value.pageId, value.nodeId].every(id => /^[a-zA-Z0-9_-]{1,128}$/.test(id || "")) || ![value.original, value.text].every(text => typeof text === "string" && new TextEncoder().encode(text).length <= 160 * 1024)) throw new Error("TEXT_DRAFT_INVALID");
    return { format: "html-text", pageId: value.pageId, nodeId: value.nodeId, original: value.original, text: value.text, composing: Boolean(value.composing) };
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
      return page.html === draft.text ? [] : [{ op: "setHtmlPage", pageId: page.id, html: inspectHtml(draft.text, { assignIds: true, allowEmpty: content.kind === "slides" }).html }];
    }
    if (draft.format === "html-text") {
      const current = inspectHtml(page.html, { allowEmpty: true }), node = current.ids.get(draft.nodeId);
      if (!node) throw new Error("TEXT_EDIT_TARGET_CHANGED");
      const original = textObject(draft.original, draft.nodeId, node.tagName);
      const replacement = textObject(draft.text, draft.nodeId, node.tagName);
      const currentHtml = comparableText(node), originalHtml = comparableText(original), nextHtml = comparableText(replacement);
      if (currentHtml !== originalHtml && currentHtml !== nextHtml) throw new Error("TEXT_EDIT_TARGET_CHANGED");
      if (currentHtml === nextHtml) return [];
      const parent = node.parentNode; replacement.parentNode = parent;
      parent.childNodes[parent.childNodes.indexOf(node)] = replacement;
      return [{ op: "setHtmlPage", pageId: page.id, html: inspectHtml(serialize(current.tree), { assignIds: true, allowEmpty: true }).html }];
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
