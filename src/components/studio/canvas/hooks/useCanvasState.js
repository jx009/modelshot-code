import { useState, useCallback, useRef, useEffect } from "react";

export function useCanvasState(dimensions, layers) {
  const [camera, setCamera] = useState({ x: 30, y: 20, scale: 1 });
  const currentCamera = useRef(camera), animation = useRef(0);
  const [cameraMoving, setCameraMoving] = useState(false);
  const getCamera = useCallback(() => currentCamera.current, []);
  const stopCamera = useCallback(() => {
    cancelAnimationFrame(animation.current);
    animation.current = 0;
    setCameraMoving(false);
  }, []);
  const commitCamera = useCallback(next => {
    setCamera(current => {
      const value = typeof next === "function" ? next(current) : next;
      currentCamera.current = value;
      return value;
    });
  }, []);
  const animateCamera = useCallback(target => {
    stopCamera();
    const start = { ...currentCamera.current };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { commitCamera(target); return; }
    const started = performance.now();
    setCameraMoving(true);
    const tick = now => {
      const t = Math.min(1, (now - started) / 280), ease = 1 - (1 - t) ** 3;
      commitCamera({ x: start.x + (target.x - start.x) * ease, y: start.y + (target.y - start.y) * ease, scale: start.scale + (target.scale - start.scale) * ease });
      if (t < 1) animation.current = requestAnimationFrame(tick);
      else { animation.current = 0; setCameraMoving(false); }
    };
    animation.current = requestAnimationFrame(tick);
  }, [commitCamera, stopCamera]);
  useEffect(() => () => cancelAnimationFrame(animation.current), []);

  const updateCamera = useCallback((next) => {
    stopCamera();
    commitCamera((current) => ({ ...current, ...next }));
  }, [commitCamera, stopCamera]);

  const zoom = useCallback(
    (factor) => {
      stopCamera();
      commitCamera((c) => {
        const scale = Math.min(4, Math.max(0.08, c.scale * factor));
        const center = { x: dimensions.width / 2, y: dimensions.height / 2 };
        return {
          scale,
          x: center.x - ((center.x - c.x) / c.scale) * scale,
          y: center.y - ((center.y - c.y) / c.scale) * scale,
        };
      });
    },
    [dimensions, commitCamera, stopCamera]
  );

  const fit = useCallback(
    () => {
      const visible = layers.filter((l) => l.visible);
      if (!visible.length) {
        updateCamera({ x: 30, y: 20, scale: 1 });
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
      updateCamera({
        scale,
        x: (dimensions.width - width * scale) / 2 - left * scale,
        y: (dimensions.height - height * scale) / 2 - top * scale,
      });
    },
    [dimensions, layers, updateCamera]
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
      updateCamera({
        scale,
        x: (dimensions.width - width * scale) / 2 - left * scale,
        y: (dimensions.height - height * scale) / 2 - top * scale,
      });
    },
    [dimensions, updateCamera]
  );

  return {
    camera,
    dimensions,
    setCamera,
    updateCamera,
    zoom,
    fit,
    fitExpansion,
    animateCamera,
    getCamera,
    stopCamera,
    cameraMoving,
  };
}
