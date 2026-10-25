"use client";

import { useEffect, useRef } from "react";

const MIN = 300, MAX = 640, DEFAULT = 380;
export default function WorkspaceSplit({ userId, zh, children }) {
  const root = useRef(null), separator = useRef(null);
  useEffect(() => {
    const element = root.current, handle = separator.current, key = `creation-chat-width:${userId}`;
    let width = DEFAULT, preferredWidth = DEFAULT, customized = false, drag = null, frame = null, pendingWidth = null;
    const max = () => Math.max(MIN, Math.min(MAX, element.getBoundingClientRect().width * 0.48));
    const responsiveWidth = () => Math.max(MIN, Math.min(MAX, element.getBoundingClientRect().width * 0.29));
    function apply(value) {
      width = Math.round(Math.min(max(), Math.max(MIN, value)));
      element.style.setProperty("--cw-chat-width", `${width}px`);
      handle.setAttribute("aria-valuenow", String(width));
      handle.setAttribute("aria-valuemax", String(max()));
    }
    function persist() { customized = true; preferredWidth = width; try { sessionStorage.setItem(key, String(width)); } catch { /* This preference is optional. */ } }
    function cancelFrame() { if (frame !== null) cancelAnimationFrame(frame); frame = null; pendingWidth = null; }
    function finish(commit) {
      if (!drag) return;
      const current = drag; drag = null;
      const next = commit ? pendingWidth ?? width : current.width;
      cancelFrame(); apply(next); delete element.dataset.resizing;
      if (handle.hasPointerCapture?.(current.pointer)) handle.releasePointerCapture(current.pointer);
      if (commit) persist();
    }
    const down = event => {
      if (event.button !== 0 || drag) return;
      event.preventDefault(); handle.focus();
      drag = { pointer: event.pointerId, x: event.clientX, width };
      handle.setPointerCapture(event.pointerId); element.dataset.resizing = "true";
    };
    const move = event => {
      if (!drag || drag.pointer !== event.pointerId) return;
      pendingWidth = drag.width + event.clientX - drag.x;
      if (frame === null) frame = requestAnimationFrame(() => { frame = null; apply(pendingWidth); });
    };
    const up = event => { if (event.pointerId === drag?.pointer) { pendingWidth = drag.width + event.clientX - drag.x; finish(true); } };
    const cancel = () => finish(false);
    const hidden = () => { if (document.visibilityState === "hidden") cancel(); };
    const keyboard = event => {
      if (event.key === "Escape" && drag) { event.preventDefault(); cancel(); return; }
      const step = event.shiftKey ? 40 : 10;
      const next = { ArrowLeft: width - step, ArrowRight: width + step, Home: MIN, End: max() }[event.key];
      if (next === undefined) return;
      event.preventDefault(); cancel(); apply(next); persist();
    };
    const reset = () => { cancel(); customized = false; apply(responsiveWidth()); try { sessionStorage.removeItem(key); } catch { /* Optional preference. */ } };
    width = responsiveWidth();
    try { const saved = Number(sessionStorage.getItem(key)); if (Number.isFinite(saved) && saved >= MIN && saved <= MAX) { width = saved; customized = true; } } catch { /* Use the default. */ }
    preferredWidth = width; apply(width);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => { if (!drag) apply(customized ? preferredWidth : responsiveWidth()); });
    observer?.observe(element);
    const listeners = { pointerdown: down, pointermove: move, pointerup: up, pointercancel: cancel, lostpointercapture: cancel, keydown: keyboard, dblclick: reset };
    for (const [type, callback] of Object.entries(listeners)) handle.addEventListener(type, callback);
    window.addEventListener("blur", cancel); document.addEventListener("visibilitychange", hidden);
    return () => { cancel(); cancelFrame(); observer?.disconnect(); for (const [type, callback] of Object.entries(listeners)) handle.removeEventListener(type, callback); window.removeEventListener("blur", cancel); document.removeEventListener("visibilitychange", hidden); };
  }, [userId]);
  return <div className="cw-workspace-body" ref={root}>{children[0]}<div ref={separator} className="cw-split-handle" role="separator" tabIndex={0} aria-label={zh ? "调整对话栏宽度" : "Resize conversation panel"} aria-orientation="vertical" aria-valuemin={MIN} aria-valuemax={MAX} aria-valuenow={DEFAULT} title={zh ? "拖动调整宽度；方向键调整，双击重置" : "Drag or use arrow keys to resize; double-click to reset"} />{children[1]}</div>;
}
