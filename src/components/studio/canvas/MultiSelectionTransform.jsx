"use client";
import { useLayoutEffect, useRef } from "react";
import { Layer, Transformer } from "react-konva";

// A single Konva transformer keeps the selection rigid while rotating/scaling.
// Commit the complete result once so undo and cloud versioning stay atomic.
export default function MultiSelectionTransform({ stage, layers, ids, accent, onCommit }) {
  const transformer = useRef(null);
  useLayoutEffect(() => {
    const nodes = ids.map(id => stage.current?.findOne(`#${id}`)).filter(Boolean);
    transformer.current?.nodes(nodes);
    transformer.current?.getLayer()?.batchDraw();
  }, [stage, layers, ids]);
  function finish() {
    const patches = transformer.current.nodes().map(node => {
      const source = layers.find(layer => layer.id === node.id());
      const scale = node.scaleX();
      const patch = { id: node.id(), x: node.x(), y: node.y(), width: Math.max(1, node.width() * scale), height: Math.max(1, node.height() * node.scaleY()), rotation: ((node.rotation() % 360) + 360) % 360 };
      if (source?.type === "text") patch.fontSize = Math.min(512, Math.max(8, (source.fontSize || 36) * scale));
      node.scale({ x: 1, y: 1 });
      return patch;
    });
    if (patches.some(p => p.width > 8192 || p.height > 8192 || Math.abs(p.x) > 100000 || Math.abs(p.y) > 100000)) {
      transformer.current.nodes().forEach(node => {
        const source = layers.find(layer => layer.id === node.id());
        if (source) node.setAttrs({ x: source.x, y: source.y, width: source.width, height: source.height, rotation: source.rotation || 0 });
      });
      transformer.current.forceUpdate();
      return;
    }
    onCommit(patches);
  }
  return <Layer><Transformer ref={transformer} name="multi-selection-transform" flipEnabled={false} keepRatio rotateEnabled
    enabledAnchors={["top-left", "top-right", "bottom-left", "bottom-right"]} padding={4}
    borderStroke={accent} anchorStroke={accent} anchorFill="#fff" anchorSize={10} anchorCornerRadius={4}
    boundBoxFunc={(old, next) => Math.min(next.width, next.height) < 24 || Math.max(next.width, next.height) > 8192 ? old : next}
    onTransformEnd={finish} onDragEnd={finish} /></Layer>;
}
