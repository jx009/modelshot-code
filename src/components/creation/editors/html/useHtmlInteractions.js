"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cleanTextChildren, formatTextRange, insertPlainText, textEditTarget } from "@/lib/creation/html/editor-text";

const byId = (doc, id) => doc?.querySelector(`[data-node-id="${CSS.escape(id)}"]`);
export default function useHtmlInteractions({ frame, page, selection, setSelection, readOnly, getContent, edit, commitPending, stageDraft, onError, onUndo, onRedo, canUndo, canRedo, onMeasure, onActivate, onSynchronize }) {
  const live = useRef(null), session = useRef(null), cleanup = useRef(null), moving = useRef(false), savedRange = useRef(null), refresh = useRef(null), resizing = useRef(null);
  const [object, setObject] = useState(null), [textEditing, setTextEditing] = useState(false), [anchor, setAnchor] = useState(null), [box, setBox] = useState(null);
  useLayoutEffect(() => { live.current = { page, selection, setSelection, readOnly, getContent, edit, commitPending, stageDraft, onError, onUndo, onRedo, canUndo, canRedo, onMeasure, onActivate, onSynchronize }; });
  const stageText = useCallback((changed = true) => {
    const current = session.current; if (!current) return;
    current.dirty ||= changed;
    if (!current.dirty) return;
    current.source.replaceChildren(...cleanTextChildren(current.node, current.doc));
    live.current.stageDraft({ pageId: current.pageId, base: current.base, nodeId: current.node.dataset.nodeId, rich: { original: current.original, text: current.source.outerHTML, composing: current.composing } });
  }, []);
  const finishText = useCallback(() => {
    if (!session.current) return;
    if (session.current.composing) throw new Error("TEXT_COMPOSITION_ACTIVE");
    stageText(false); live.current.commitPending();
    session.current.node.removeAttribute("contenteditable"); session.current.node.removeAttribute("spellcheck");
    session.current = null; savedRange.current = null; setTextEditing(false);
    // Commit followed immediately by undo can return to the same source string
    // within one React batch. Explicitly reconcile the live edited subtree.
    live.current.onSynchronize?.();
  }, [stageText]);
  const discardText = useCallback(() => {
    const current = session.current; if (!current) return;
    session.current = null; savedRange.current = null;
    for (const attribute of [...current.node.attributes]) current.node.removeAttribute(attribute.name);
    for (const attribute of [...current.rendered.attributes]) current.node.setAttribute(attribute.name, attribute.value);
    current.node.replaceChildren(...[...current.rendered.childNodes].map(child => child.cloneNode(true)));
    setTextEditing(false); refresh.current?.();
  }, []);
  const cancelResize = useCallback(() => {
    const current = resizing.current; if (!current) return;
    resizing.current = null; moving.current = false; current.node.style.cssText = current.css; refresh.current?.();
  }, []);
  const close = useCallback(() => {
    try { finishText(); live.current.setSelection([]); setAnchor(null); setBox(null); return true; } catch (error) { live.current.onError?.(error); return false; }
  }, [finishText]);
  const history = useCallback(direction => {
    try { finishText(); const current = live.current; if (direction === "undo") current.onUndo?.(); else if (current.canRedo) current.onRedo?.(); } catch (error) { live.current.onError?.(error); }
  }, [finishText]);
  const format = useCallback((property, value) => {
    if (live.current.readOnly) return;
    try {
      const current = session.current;
      if (current) {
        if (current.composing) return;
        savedRange.current = formatTextRange(current.node, property, value, ["textAlign", "lineHeight"].includes(property) ? null : savedRange.current);
        // Whole-object styles belong to the original source object, never the
        // projected document whose image URLs and CSP are disposable.
        current.source.style[property] = current.node.style[property];
        stageText(); refresh.current?.();
      } else live.current.edit((doc, ids) => ids.forEach(id => { const node = byId(doc, id); if (node) node.style[property] = value; }));
    } catch (error) { live.current.onError?.(error); }
  }, [stageText]);
  const resize = {
    start(event, corner) {
      if (live.current.readOnly) return;
      try { finishText(); } catch (error) { live.current.onError?.(error); return; }
      const node = byId(frame.current?.contentDocument, live.current.selection[0]); if (!node) return;
      event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
      const rect = node.getBoundingClientRect(), style = node.ownerDocument.defaultView.getComputedStyle(node);
      resizing.current = { node, corner, x: event.clientX, y: event.clientY, ratio: frame.current.getBoundingClientRect().width / live.current.page.width, width: rect.width, height: rect.height, left: parseFloat(style.left) || 0, top: parseFloat(style.top) || 0, position: style.position, css: node.style.cssText, next: null };
      moving.current = true;
    },
    move(event) {
      const current = resizing.current; if (!current) return;
      let dx = (event.clientX - current.x) / current.ratio, dy = (event.clientY - current.y) / current.ratio;
      const west = current.corner.includes("w"), north = current.corner.includes("n");
      let width = Math.max(8, Math.min(8192, current.width + (west ? -dx : dx))), height = Math.max(8, Math.min(8192, current.height + (north ? -dy : dy)));
      if (event.shiftKey || current.node.tagName === "IMG") { const scale = Math.max(width / current.width, height / current.height); width = Math.min(8192, current.width * scale); height = Math.min(8192, current.height * scale); }
      dx = west ? current.width - width : 0; dy = north ? current.height - height : 0;
      current.next = { width, height, left: current.left + dx, top: current.top + dy };
      const node = current.node; if (!["absolute", "fixed"].includes(current.position)) node.style.position = "relative";
      Object.assign(node.style, { width: width + "px", height: height + "px", left: current.next.left + "px", top: current.next.top + "px", boxSizing: "border-box", maxWidth: "none" });
      refresh.current?.();
    },
    end(cancel = false) {
      const current = resizing.current; if (!current) return;
      resizing.current = null; moving.current = false; current.node.style.cssText = current.css;
      if (!cancel && current.next) live.current.edit(source => { const node = byId(source, current.node.dataset.nodeId); if (!node) return; if (!["absolute", "fixed"].includes(current.position)) node.style.position = "relative"; for (const [name, value] of Object.entries(current.next)) node.style[name] = value + "px"; node.style.boxSizing = "border-box"; node.style.maxWidth = "none"; });
      refresh.current?.();
    },
  };
  const loaded = useCallback(() => {
    cleanup.current?.();
    const doc = frame.current?.contentDocument; if (!doc?.body) return;
    let gesture = null, animation = null, paintFrame = null;
    const update = () => {
      const current = live.current, node = byId(doc, current.selection[0]);
      doc.querySelectorAll("[data-cw-selected]").forEach(item => { if (!current.selection.includes(item.dataset.nodeId)) { item.style.outline = item.dataset.cwOutline || ""; delete item.dataset.cwSelected; delete item.dataset.cwOutline; } });
      for (const id of current.selection) { const item = byId(doc, id); if (item && !item.hasAttribute("data-cw-selected")) { item.dataset.cwOutline = item.style.outline; item.dataset.cwSelected = "true"; item.style.outline = "2px solid #58a6ff"; } }
      const iframe = frame.current.getBoundingClientRect(), ratio = iframe.width / current.page.width;
      const scroller = frame.current.closest(".cw-slide-document")?.getBoundingClientRect();
      if (scroller && (iframe.bottom <= scroller.top || iframe.top >= scroller.bottom)) { setAnchor(null); setBox(null); return; }
      if (!node) { setObject(null); setBox(null); setAnchor({ left: iframe.left + 28, top: Math.max(iframe.top + 22, (scroller?.top || 0) + 8) }); return; }
      const rect = node.getBoundingClientRect();
      const rangeNode = savedRange.current?.startContainer, rangeElement = rangeNode?.nodeType === 1 ? rangeNode : rangeNode?.parentElement;
      const style = doc.defaultView.getComputedStyle(session.current?.node === node && rangeElement && node.contains(rangeElement) ? rangeElement : node);
      const info = { id: node.dataset.nodeId, tag: node.tagName, fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight, fontStyle: style.fontStyle, textDecoration: style.textDecorationLine, width: Math.round(rect.width), height: Math.round(rect.height), src: node.tagName === "IMG" ? node.src : undefined, naturalWidth: node.naturalWidth, naturalHeight: node.naturalHeight };
      setObject(previous => JSON.stringify(previous) === JSON.stringify(info) ? previous : info);
      const bounds = { left: iframe.left + rect.left * ratio, top: iframe.top + rect.top * ratio, width: rect.width * ratio, height: rect.height * ratio };
      setBox(bounds); setAnchor({ left: bounds.left, top: Math.max(bounds.top - 58, (scroller?.top || 0) + 8) });
    };
    const schedule = () => { if (animation === null) animation = requestAnimationFrame(() => { animation = null; update(); }); };
    refresh.current = schedule;
    const beginText = node => {
      if (!node || live.current.readOnly) return;
      if (session.current?.node === node) return;
      finishText();
      live.current.onActivate?.();
      const current = live.current.getContent().pages.find(item => item.id === live.current.page.id);
      const source = new DOMParser().parseFromString(current.html, "text/html");
      const original = byId(source, node.dataset.nodeId); if (!original) return;
      session.current = { node, rendered: node.cloneNode(true), doc: source, source: original, original: original.outerHTML, base: current.html, pageId: current.id, composing: false, dirty: false };
      live.current.setSelection([node.dataset.nodeId]); setTextEditing(true);
      node.contentEditable = "true"; node.spellcheck = false; node.focus(); schedule();
    };
    const select = event => {
      if (event.target.closest("a")) event.preventDefault();
      if (live.current.readOnly || event.button !== 0) return;
      live.current.onActivate?.();
      const element = event.target.closest("[data-node-id]");
      if (element?.isContentEditable || element?.closest("[data-cw-master]")) return;
      try { finishText(); } catch (error) { live.current.onError?.(error); return; }
      if (!element) { live.current.setSelection([]); schedule(); return; }
      event.preventDefault(); const id = element.dataset.nodeId;
      live.current.setSelection(current => event.shiftKey ? current.includes(id) ? current.filter(value => value !== id) : [...current, id] : [id]);
      if (!event.shiftKey) {
        const style = doc.defaultView.getComputedStyle(element);
        gesture = { id, element, pointer: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, dy: 0, left: parseFloat(style.left) || 0, top: parseFloat(style.top) || 0, position: style.position, transform: element.style.transform, moved: false };
        element.setPointerCapture?.(event.pointerId); moving.current = true;
      }
      schedule();
    };
    const move = event => {
      if (!gesture || !event.buttons || live.current.readOnly) return;
      gesture.dx = event.clientX - gesture.x; gesture.dy = event.clientY - gesture.y;
      if (!gesture.moved && Math.abs(gesture.dx) + Math.abs(gesture.dy) < 4) return;
      gesture.moved = true;
      if (paintFrame === null) paintFrame = requestAnimationFrame(() => { paintFrame = null; if (gesture) { gesture.element.style.transform = `${gesture.transform} translate(${gesture.dx}px,${gesture.dy}px)`; update(); } });
    };
    const end = () => {
      const ended = gesture; gesture = null; moving.current = false; cancelAnimationFrame(paintFrame); paintFrame = null;
      if (!ended) return;
      ended.element.style.transform = ended.transform;
      if (ended.element.hasPointerCapture?.(ended.pointer)) ended.element.releasePointerCapture(ended.pointer);
      if (ended.moved) live.current.edit(source => {
        const node = byId(source, ended.id); if (!node) return;
        if (!["absolute", "fixed"].includes(ended.position)) node.style.position = "relative";
        node.style.left = `${ended.left + ended.dx}px`; node.style.top = `${ended.top + ended.dy}px`;
      });
      schedule();
    };
    const cancel = () => { if (gesture) { gesture.element.style.transform = gesture.transform; if (gesture.element.hasPointerCapture?.(gesture.pointer)) gesture.element.releasePointerCapture(gesture.pointer); } gesture = null; moving.current = false; cancelAnimationFrame(paintFrame); paintFrame = null; cancelResize(); schedule(); };
    const double = event => { try { beginText(textEditTarget(event.target)); } catch (error) { live.current.onError?.(error); } };
    const input = () => { try { stageText(); schedule(); } catch (error) { live.current.onError?.(error); } };
    const paste = event => { if (!session.current) return; event.preventDefault(); if (insertPlainText(session.current.node, event.clipboardData?.getData("text/plain") || "")) input(); };
    const beforeinput = event => {
      if (!session.current || !["insertParagraph", "insertLineBreak"].includes(event.inputType)) return;
      event.preventDefault();
      const node = session.current.node;
      node.style.whiteSpace = "pre-wrap"; session.current.source.style.whiteSpace = "pre-wrap";
      if (insertPlainText(node, "\n")) input();
    };
    const keydown = event => {
      if (event.isComposing || live.current.readOnly) return;
      const current = live.current;
      if ((event.ctrlKey || event.metaKey) && ["z", "y"].includes(event.key.toLowerCase())) {
        event.preventDefault(); history(event.key.toLowerCase() === "y" || event.shiftKey ? "redo" : "undo"); return;
      }
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      if (session.current) return;
      if (!current.selection.length) return;
      if (["Delete", "Backspace"].includes(event.key)) { event.preventDefault(); if (current.edit(source => current.selection.forEach(id => byId(source, id)?.remove())) !== false) current.setSelection([]); }
      const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (delta) { event.preventDefault(); current.edit(source => current.selection.forEach(id => { const node = byId(source, id), rendered = byId(doc, id); if (!node || !rendered) return; const style = doc.defaultView.getComputedStyle(rendered), step = event.shiftKey ? 10 : 1; if (!["absolute", "fixed"].includes(style.position)) node.style.position = "relative"; node.style.left = (parseFloat(style.left) || 0) + delta[0] * step + "px"; node.style.top = (parseFloat(style.top) || 0) + delta[1] * step + "px"; })); }
    };
    const selectedRange = () => { const value = doc.getSelection(); if (session.current && value?.rangeCount && session.current.node.contains(value.getRangeAt(0).commonAncestorContainer)) { savedRange.current = value.getRangeAt(0).cloneRange(); schedule(); } };
    const composeStart = () => { if (session.current) session.current.composing = true; };
    const composeEnd = () => { if (session.current) { session.current.composing = false; input(); } };
    const blur = () => {
      try { if (session.current && !session.current.composing) stageText(false); } catch (error) { live.current.onError?.(error); }
      queueMicrotask(() => {
        if (!session.current || session.current.composing || document.activeElement?.closest(".cw-floating-editor") || session.current.node.contains(doc.activeElement)) return;
        try { finishText(); } catch (error) { live.current.onError?.(error); }
      });
    };
    const measure = () => { live.current.onMeasure(doc); schedule(); };
    const dragstart = event => { if (!live.current.readOnly) event.preventDefault(); };
    const handlers = { pointerdown: select, pointermove: move, pointerup: end, pointercancel: cancel, dragstart, dblclick: double, beforeinput, input, paste, keydown, selectionchange: selectedRange, compositionstart: composeStart, compositionend: composeEnd, focusout: blur, load: measure };
    for (const [name, handler] of Object.entries(handlers)) doc.addEventListener(name, handler, name === "load");
    window.addEventListener("pointerup", end); window.addEventListener("blur", cancel); window.addEventListener("resize", schedule); window.addEventListener("scroll", schedule, true);
    measure();
    cleanup.current = () => { cancel(); cancelAnimationFrame(animation); for (const [name, handler] of Object.entries(handlers)) doc.removeEventListener(name, handler, name === "load"); window.removeEventListener("pointerup", end); window.removeEventListener("blur", cancel); window.removeEventListener("resize", schedule); window.removeEventListener("scroll", schedule, true); };
  }, [frame, finishText, stageText, history, close, cancelResize]);
  const beforeUpdate = useCallback(() => { cleanup.current?.(); cleanup.current = null; }, []);
  useEffect(() => { refresh.current?.(); }, [selection, page.html]);
  useEffect(() => () => { cleanup.current?.(); session.current = null; savedRange.current = null; }, []);
  return { loaded, beforeUpdate, object, box, anchor, textEditing, format, close, history, finishText, discardText, moving, resize };
}
