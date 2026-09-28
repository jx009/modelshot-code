import { useState, useCallback } from "react";

export function useCanvasState(dimensions, layers) {
  const [camera, setCamera] = useState({ x: 30, y: 20, scale: 1 });

  const updateCamera = useCallback((next) => {
    setCamera((current) => ({ ...current, ...next }));
  }, []);

  const zoom = useCallback(
    (factor) => {
      setCamera((c) => {
        const scale = Math.min(4, Math.max(0.08, c.scale * factor));
        const center = { x: dimensions.width / 2, y: dimensions.height / 2 };
        return {
          scale,
          x: center.x - ((center.x - c.x) / c.scale) * scale,
          y: center.y - ((center.y - c.y) / c.scale) * scale,
        };
      });
    },
    [dimensions]
  );

  const fit = useCallback(
    () => {
      const visible = layers.filter((l) => l.visible);
      if (!visible.length) {
        setCamera({ x: 30, y: 20, scale: 1 });
        return;
      }
      const left = Math.min(...visible.map((l) => l.x));
      const top = Math.min(...visible.map((l) => l.y));
      const right = Math.max(...visible.map((l) => l.x + l.width));
      const bottom = Math.max(...visible.map((l) => l.y + l.height));
      const width = right - left;
      const height = bottom - top;
      const scale = Math.max(
        0.08,
        Math.min(
          1.5,
          (dimensions.width - 110) / width,
          (dimensions.height - 180) / height
        )
      );
      setCamera({
        scale,
        x: (dimensions.width - width * scale) / 2 - left * scale,
        y: (dimensions.height - height * scale) / 2 - top * scale,
      });
    },
    [dimensions, layers]
  );

  const fitExpansion = useCallback(
    (selection, expandPadding) => {
      if (!selection?.pixelWidth || !selection?.pixelHeight) return;
      const paddingEdges =
        typeof expandPadding === "number"
          ? { left: expandPadding, right: expandPadding, top: expandPadding, bottom: expandPadding }
          : expandPadding;
      const scaleX = selection.width / selection.pixelWidth;
      const scaleY = selection.height / selection.pixelHeight;
      const left = selection.x - paddingEdges.left * scaleX;
      const top = selection.y - paddingEdges.top * scaleY;
      const width = selection.width + (paddingEdges.left + paddingEdges.right) * scaleX;
      const height = selection.height + (paddingEdges.top + paddingEdges.bottom) * scaleY;
      const scale = Math.max(
        0.08,
        Math.min(
          1.5,
          (dimensions.width - 110) / width,
          (dimensions.height - 180) / height
        )
      );
      setCamera({
        scale,
        x: (dimensions.width - width * scale) / 2 - left * scale,
        y: (dimensions.height - height * scale) / 2 - top * scale,
      });
    },
    [dimensions]
  );

  return {
    camera,
    dimensions,
    setCamera,
    updateCamera,
    zoom,
    fit,
    fitExpansion,
  };
}
