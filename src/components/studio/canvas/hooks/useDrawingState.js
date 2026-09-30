import { useState, useCallback, useRef } from "react";

// Pointer events can arrive hundreds of times per frame on a fast brush.  The
// old implementation copied the complete points array and re-rendered the
// whole Konva layer for every event (O(n²) work), which could freeze or crash
// the studio when a user painted densely.  Keep the live path mutable and
// publish at most once per animation frame.
const MAX_STROKE_POINTS = 8192;

export function useDrawingState() {
  const [strokes, setStrokes] = useState([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const activeStroke = useRef(null);
  const frame = useRef(null);

  const cancelFrame = useCallback(() => {
    if (frame.current == null) return;
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame.current);
    else clearTimeout(frame.current);
    frame.current = null;
  }, []);

  const commitActiveStroke = useCallback(() => {
    frame.current = null;
    const stroke = activeStroke.current;
    if (!stroke) return;
    const snapshot = { ...stroke, points: stroke.points.slice() };
    setStrokes(current => current.length ? [...current.slice(0, -1), snapshot] : current);
  }, []);

  const scheduleCommit = useCallback(() => {
    if (frame.current != null) return;
    if (typeof requestAnimationFrame === "function") frame.current = requestAnimationFrame(commitActiveStroke);
    else frame.current = setTimeout(commitActiveStroke, 16);
  }, [commitActiveStroke]);

  const startStroke = useCallback((point, target, width) => {
    activeStroke.current = {
      target,
      width,
      points: [point.x, point.y, point.x + 0.1, point.y + 0.1],
    };
    const snapshot = { ...activeStroke.current, points: activeStroke.current.points.slice() };
    setIsDrawing(true);
    setStrokes(current => [...current, snapshot]);
  }, []);

  const addPoint = useCallback((point) => {
    const stroke = activeStroke.current;
    if (!stroke) return;
    let points = stroke.points;
    const last = points.length - 2;
    // Sub-pixel samples do not change the rasterized mask but do multiply
    // memory and Konva work during a very fast, dense stroke.
    const dx = point.x - points[last], dy = point.y - points[last + 1];
    if (dx * dx + dy * dy < 0.64) return;
    if (points.length >= MAX_STROKE_POINTS * 2) {
      // Keep drawing instead of dropping the rest of a long stroke.  Retain
      // every other sample and both endpoints to make room for new samples.
      const compacted = [points[0], points[1]];
      for (let index = 2; index < points.length - 2; index += 4) compacted.push(points[index], points[index + 1]);
      compacted.push(points[points.length - 2], points[points.length - 1]);
      stroke.points = compacted;
      points = compacted;
    }
    points.push(point.x, point.y);
    scheduleCommit();
  }, [scheduleCommit]);

  const endStroke = useCallback(() => {
    cancelFrame();
    commitActiveStroke();
    activeStroke.current = null;
    setIsDrawing(false);
  }, [cancelFrame, commitActiveStroke]);

  const clearStrokes = useCallback((targetId) => {
    setStrokes((prev) => prev.filter((s) => s.target !== targetId));
  }, []);

  const clearAll = useCallback(() => {
    cancelFrame();
    setStrokes([]);
    activeStroke.current = null;
    setIsDrawing(false);
  }, [cancelFrame]);

  return {
    strokes,
    isDrawing,
    startStroke,
    addPoint,
    endStroke,
    clearStrokes,
    clearAll,
  };
}
