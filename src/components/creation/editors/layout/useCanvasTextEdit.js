"use client";

import { useCallback, useImperativeHandle, useRef, useState } from "react";

// The mutable draft receives DOM input synchronously. Imperative saves must not
// depend on React having rendered the latest keystroke or a blur event firing.
export function useCanvasTextEdit({ page, readOnly, onCommit, onError, controllerRef, onPendingChange, onDraftChange }) {
  const current = useRef(null), pending = useRef(false);
  const [draft, setDraft] = useState(null);
  const report = useCallback(value => {
    const next = Boolean(value && (value.composing || value.text !== value.original));
    if (next || pending.current) onDraftChange?.(next ? { pageId: value.pageId, nodeId: value.nodeId, original: value.original, text: value.text, composing: value.composing } : null);
    if (next !== pending.current) { pending.current = next; onPendingChange?.(next); }
  }, [onPendingChange, onDraftChange]);
  const update = useCallback(value => { current.current = value; setDraft(value); report(value); }, [report]);
  const commit = useCallback(() => {
    const value = current.current;
    if (!value) return true;
    if (value.composing) throw new Error("TEXT_COMPOSITION_ACTIVE");
    if (value.pageId !== page.id) throw new Error("TEXT_EDIT_TARGET_CHANGED");
    const node = page.nodes.find(node => node.id === value.nodeId);
    if (!node || node.type !== "text" || (node.text !== value.original && node.text !== value.text)) throw new Error("TEXT_EDIT_TARGET_CHANGED");
    if (node.text !== value.text) {
      if (readOnly || node.locked) throw new Error("TEXT_EDIT_NOT_COMMITTED");
      if (onCommit([{ op: "setText", pageId: page.id, nodeId: node.id, text: value.text }]) === false) throw new Error("TEXT_EDIT_NOT_COMMITTED");
    }
    update(null);
    return true;
  }, [page, readOnly, onCommit, update]);
  const tryCommit = useCallback(() => {
    try { return commit(); } catch (error) { onError?.(error); return false; }
  }, [commit, onError]);
  useImperativeHandle(controllerRef, () => ({ commitPending: commit,
    getPendingText: () => {
      const value = current.current;
      return value && (value.composing || value.text !== value.original) ? { pageId: value.pageId, nodeId: value.nodeId, original: value.original, text: value.text, composing: value.composing } : null;
    },
    discardPending: () => update(null),
  }), [commit, update]);
  const begin = useCallback((nodeId, text) => {
    if (readOnly || current.current?.nodeId === nodeId) return;
    if (current.current && !tryCommit()) return;
    const node = page.nodes.find(node => node.id === nodeId);
    if (!node || node.type !== "text" || node.locked) return;
    update({ pageId: page.id, nodeId, original: text, text, node, composing: false, blurred: false });
  }, [page, readOnly, tryCommit, update]);
  const input = useCallback(text => { if (current.current) update({ ...current.current, text }); }, [update]);
  const compositionStart = useCallback(() => { if (current.current) update({ ...current.current, composing: true }); }, [update]);
  const compositionEnd = useCallback(text => {
    if (!current.current) return;
    const blurred = current.current.blurred;
    update({ ...current.current, text, composing: false, blurred: false });
    if (blurred) tryCommit();
  }, [update, tryCommit]);
  const blur = useCallback(() => {
    if (current.current?.composing) { update({ ...current.current, blurred: true }); return; }
    tryCommit();
  }, [tryCommit, update]);
  const cancel = useCallback(() => update(null), [update]);
  return { draft, begin, input, compositionStart, compositionEnd, blur, cancel, tryCommit };
}
