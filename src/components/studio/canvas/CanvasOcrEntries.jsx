"use client";

import { useLayoutEffect, useRef } from "react";
import { ScanText } from "lucide-react";

// Konva owns live transforms during gestures; document coordinates only commit
// on release. Follow those nodes without saving or rerendering the workbench
// on every pointer move. Keep native buttons for keyboard and touch access.
export default function CanvasOcrEntries({ stage, layers, entries, onOpen, zh }) {
  const buttons = useRef(new Map());
  useLayoutEffect(() => {
    const canvas = stage.current;
    if (!canvas) return;
    let frame = null;
    const nodes = entries.map(entry => ({
      id: entry.layerId,
      node: canvas.findOne(node => node.id() === entry.layerId),
    }));
    const position = () => {
      frame = null;
      for (const { id, node } of nodes) {
        const button = buttons.current.get(id);
        if (!button) continue;
        button.hidden = !node?.isVisible();
        if (!node?.isVisible()) continue;
        const bounds = node.getClientRect({ skipShadow: true, skipStroke: true });
        button.style.transform = `translate3d(${bounds.x}px, ${bounds.y + bounds.height + 8}px, 0)`;
      }
    };
    const schedule = () => { if (frame === null) frame = requestAnimationFrame(position); };
    // Camera attributes cover zoom, fit, restored views and camera animation.
    // Konva transformer attribute changes do not all bubble: subscribe to the
    // image nodes as well, including every member of a multi-selection.
    const events = "dragmove.ocrEntries dragend.ocrEntries transform.ocrEntries transformend.ocrEntries xChange.ocrEntries yChange.ocrEntries scaleXChange.ocrEntries scaleYChange.ocrEntries";
    const nodeEvents = `${events} widthChange.ocrEntries heightChange.ocrEntries rotationChange.ocrEntries visibleChange.ocrEntries`;
    canvas.on(events, schedule);
    for (const { node } of nodes) node?.on(nodeEvents, schedule);
    position();
    return () => {
      canvas.off(events, schedule);
      for (const { node } of nodes) node?.off(nodeEvents, schedule);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [stage, layers, entries]);

  return entries.map(entry => {
    const layer = layers.find(item => item.id === entry.layerId && item.visible);
    if (!layer) return null;
    return <button key={entry.layerId} ref={node => { if (node) buttons.current.set(entry.layerId, node); else buttons.current.delete(entry.layerId); }}
      className="ms-canvas-ocr-entry" aria-label={zh ? `查看文字 · ${layer.name}` : `View text · ${layer.name}`}
      onClick={() => onOpen?.(entry.jobId)}><ScanText size={15} /><span>{zh ? "查看文字" : "View text"}</span></button>;
  });
}
