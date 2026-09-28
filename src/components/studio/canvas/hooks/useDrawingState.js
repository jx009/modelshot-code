import { useState, useCallback, useRef } from "react";

export function useDrawingState() {
  const [strokes, setStrokes] = useState([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const activeStroke = useRef(null);

  const startStroke = useCallback((point, target, width) => {
    activeStroke.current = {
      target,
      width,
      points: [point.x, point.y, point.x + 0.1, point.y + 0.1],
    };
    setIsDrawing(true);
    setStrokes((current) => [...current, activeStroke.current]);
  }, []);

  const addPoint = useCallback((point) => {
    if (!activeStroke.current) return;
    activeStroke.current = {
      ...activeStroke.current,
      points: [...activeStroke.current.points, point.x, point.y],
    };
    setStrokes((current) => [...current.slice(0, -1), activeStroke.current]);
  }, []);

  const endStroke = useCallback(() => {
    activeStroke.current = null;
    setIsDrawing(false);
  }, []);

  const clearStrokes = useCallback((targetId) => {
    setStrokes((prev) => prev.filter((s) => s.target !== targetId));
  }, []);

  const clearAll = useCallback(() => {
    setStrokes([]);
    activeStroke.current = null;
    setIsDrawing(false);
  }, []);

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
