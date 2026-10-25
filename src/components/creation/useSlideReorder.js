"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function slideDropIndex(pages, sourceId, targetId, after) {
  const from = pages.findIndex(page => page.id === sourceId), target = pages.findIndex(page => page.id === targetId);
  if (from < 0 || target < 0 || sourceId === targetId) return from;
  const boundary = target + (after ? 1 : 0);
  return Math.max(0, Math.min(pages.length - 1, boundary - (from < boundary ? 1 : 0)));
}
// Only a completed drop emits a journal operation. Touch and keyboard use the handle.
export function useSlideReorder({ pages, readOnly, onMove }) {
  const root = useRef(null), drag = useRef(null), target = useRef(null), frame = useRef(null);
  const [indicator, setIndicator] = useState(null), [announcement, setAnnouncement] = useState("");
  const clear = useCallback(() => {
    cancelAnimationFrame(frame.current); frame.current = null; drag.current = null; target.current = null; setIndicator(null);
  }, []);
  useEffect(() => {
    const hidden = () => { if (document.visibilityState === "hidden") clear(); };
    window.addEventListener("blur", clear); document.addEventListener("visibilitychange", hidden);
    return () => { clear(); window.removeEventListener("blur", clear); document.removeEventListener("visibilitychange", hidden); };
  }, [clear]);
  function over(element, y) {
    if (!drag.current || !element || !root.current?.contains(element)) return;
    const rect = element.getBoundingClientRect(), id = element.dataset.slideId;
    const style = getComputedStyle(root.current), horizontal = style.display === "flex" && style.flexDirection === "row";
    const after = horizontal ? drag.current.x > rect.left + rect.width / 2 : y > rect.top + rect.height / 2;
    if (target.current?.id === id && target.current.after === after) return;
    target.current = { id, after }; setIndicator({ id, after });
  }
  function autoScroll() {
    const box = root.current, current = drag.current;
    if (!box || !current) return;
    const rect = box.getBoundingClientRect(), y = current.y;
    const style = getComputedStyle(box), horizontal = style.display === "flex" && style.flexDirection === "row";
    const point = horizontal ? current.x : y, start = horizontal ? rect.left : rect.top, end = horizontal ? rect.right : rect.bottom;
    const delta = point < start + 48 ? -12 : point > end - 48 ? 12 : 0;
    if (delta) { box.scrollBy({ left: horizontal ? delta : 0, top: horizontal ? 0 : delta }); over(document.elementFromPoint(current.x, y)?.closest("[data-slide-id]"), y); }
    frame.current = requestAnimationFrame(autoScroll);
  }
  function finish() {
    const source = drag.current?.id, destination = target.current;
    if (!readOnly && source && destination) {
      const index = slideDropIndex(pages, source, destination.id, destination.after);
      if (index >= 0 && index !== pages.findIndex(page => page.id === source) && onMove(source, index) !== false) setAnnouncement(String(index + 1));
    }
    clear();
  }
  const rowProps = id => ({
    "data-slide-id": id, "data-drop": indicator?.id === id ? indicator.after ? "after" : "before" : undefined,
    draggable: !readOnly,
    onDragStart: event => {
      if (readOnly) return event.preventDefault();
      drag.current = { id, x: event.clientX, y: event.clientY };
      event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", id);
      cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(autoScroll);
    },
    onDragOver: event => { if (!drag.current || readOnly) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; drag.current.x = event.clientX; drag.current.y = event.clientY; over(event.currentTarget, event.clientY); },
    onDrop: event => { if (!drag.current) return; event.preventDefault(); event.stopPropagation(); over(event.currentTarget, event.clientY); finish(); },
    onDragEnd: clear,
  });
  const handleProps = id => ({
    disabled: readOnly, style: { touchAction: "none" },
    onPointerDown: event => {
      if (readOnly || event.button !== 0) return;
      event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { id, x: event.clientX, y: event.clientY };
      frame.current = requestAnimationFrame(autoScroll);
    },
    onPointerMove: event => { if (!drag.current) return; drag.current.x = event.clientX; drag.current.y = event.clientY; over(document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-slide-id]"), event.clientY); },
    onPointerUp: event => { if (!drag.current) return; event.preventDefault(); finish(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); },
    onPointerCancel: clear, onLostPointerCapture: clear,
    onKeyDown: event => {
      if (event.key === "Escape") { clear(); return; }
      if (readOnly || !event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault(); const index = pages.findIndex(page => page.id === id) + (event.key === "ArrowUp" ? -1 : 1);
      if (index >= 0 && index < pages.length && onMove(id, index) !== false) setAnnouncement(String(index + 1));
    },
  });
  return { root, rowProps, handleProps, announcement, isDragging: () => Boolean(drag.current) };
}
