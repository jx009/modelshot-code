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

  const previewFrame = useRef(0), previewSettle = useRef(0), previewTarget = useRef(null);
  // 以实时 camera 为基准合并：滚轮预览尚未提交时，React 状态里的值已经过期。
  const updateCamera = useCallback((next) => {
    stopCamera();
    clearTimeout(previewSettle.current);
    previewSettle.current = 0;
    commitCamera(() => ({ ...currentCamera.current, ...next }));
  }, [commitCamera, stopCamera]);

  // 高频交互（滚轮缩放、触控板捏合）期间不进 React：直接改 Stage 变换，
  // 每帧最多绘制一次；停止 120ms 后才提交一次状态，让依赖 camera 的叠加层同步。
  // react-konva 只在 props 变化时重设节点属性，因此预览期间不会被旧 props 覆盖。
  const previewCamera = useCallback((stageNode, next) => {
    cancelAnimationFrame(animation.current);
    animation.current = 0;
    const value = typeof next === "function" ? next(currentCamera.current) : next;
    currentCamera.current = value;
    previewTarget.current = { node: stageNode, value };
    if (!previewFrame.current) previewFrame.current = requestAnimationFrame(() => {
      previewFrame.current = 0;
      const target = previewTarget.current;
      if (!target?.node) return;
      target.node.position({ x: target.value.x, y: target.value.y });
      target.node.scale({ x: target.value.scale, y: target.value.scale });
      target.node.batchDraw();
    });
    if (!previewSettle.current) setCameraMoving(true);
    clearTimeout(previewSettle.current);
    previewSettle.current = setTimeout(() => {
      previewSettle.current = 0;
      setCameraMoving(false);
      setCamera(currentCamera.current);
    }, 120);
  }, []);
  useEffect(() => () => { cancelAnimationFrame(previewFrame.current); clearTimeout(previewSettle.current); }, []);

  const zoom = useCallback(
    (factor) => {
      stopCamera();
      clearTimeout(previewSettle.current);
      previewSettle.current = 0;
      commitCamera(() => {
        const c = currentCamera.current;
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
    previewCamera,
    zoom,
    fit,
    fitExpansion,
    animateCamera,
    getCamera,
    stopCamera,
    cameraMoving,
  };
}
