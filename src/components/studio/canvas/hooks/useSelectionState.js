import { useState, useCallback, useRef } from "react";

export function useSelectionState() {
  const [movePreview, setMovePreview] = useState(null);
  const [moveSelection, setMoveSelection] = useState(null);
  const [moveMask, setMoveMask] = useState(null);
  const [crop, setCrop] = useState(null);

  const cropStart = useRef(null);
  const activeMove = useRef(null);
  const moveMaskRef = useRef(null);

  const startCrop = useCallback((point) => {
    cropStart.current = point;
    setCrop(null);
  }, []);

  const updateCrop = useCallback((rect) => {
    setCrop(rect);
  }, []);

  const startMoveRect = useCallback((point) => {
    cropStart.current = point;
    activeMove.current = {
      rectangle: { left: point.x, top: point.y, width: 1, height: 1 },
    };
    setMoveSelection(activeMove.current);
  }, []);

  const updateMoveRect = useCallback((rect) => {
    activeMove.current = { rectangle: rect };
    setMoveSelection(activeMove.current);
  }, []);

  const startMoveLasso = useCallback((point) => {
    activeMove.current = {
      polygon: [point.x, point.y, point.x + 0.1, point.y + 0.1],
    };
    setMoveSelection(activeMove.current);
  }, []);

  const addLassoPoint = useCallback((point) => {
    if (!activeMove.current?.polygon) return;
    activeMove.current = {
      polygon: [...activeMove.current.polygon, point.x, point.y],
    };
    setMoveSelection(activeMove.current);
  }, []);

  const setMovePreviewData = useCallback((data) => {
    setMovePreview(data);
  }, []);

  const setMoveMaskData = useCallback((data) => {
    moveMaskRef.current = data;
    setMoveMask(data);
  }, []);

  const clearMove = useCallback(() => {
    activeMove.current = null;
    cropStart.current = null;
    moveMaskRef.current = null;
    setMovePreview(null);
    setMoveSelection(null);
    setMoveMask(null);
  }, []);

  const clearAll = useCallback(() => {
    setCrop(null);
    clearMove();
  }, [clearMove]);

  return {
    movePreview,
    moveSelection,
    moveMask,
    moveMaskRef,
    crop,
    cropStart,
    activeMove,
    startCrop,
    updateCrop,
    startMoveRect,
    updateMoveRect,
    startMoveLasso,
    addLassoPoint,
    setMovePreviewData,
    setMoveMaskData,
    clearMove,
    clearAll,
  };
}
