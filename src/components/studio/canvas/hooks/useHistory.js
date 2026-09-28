import { useState, useCallback, useRef } from "react";

/**
 * History management hook for undo/redo functionality
 * @param {number} maxHistorySize - Maximum number of history states to keep
 * @returns {{
 *   push: (state: any) => void,
 *   undo: () => any | null,
 *   redo: () => any | null,
 *   canUndo: boolean,
 *   canRedo: boolean,
 *   clear: () => void,
 *   currentIndex: number,
 *   historySize: number
 * }}
 */
export function useHistory(maxHistorySize = 50) {
  const [history, setHistory] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const isInternalUpdate = useRef(false);

  /**
   * Push a new state to history
   * Clears any redo states after current position
   */
  const push = useCallback((state) => {
    if (isInternalUpdate.current) return;

    setHistory(prev => {
      // Remove any states after current index (clear redo stack)
      const newHistory = prev.slice(0, currentIndex + 1);

      // Add new state
      newHistory.push({
        state: JSON.parse(JSON.stringify(state)), // Deep clone
        timestamp: Date.now()
      });

      // Limit history size
      if (newHistory.length > maxHistorySize) {
        newHistory.shift();
        setCurrentIndex(maxHistorySize - 1);
      } else {
        setCurrentIndex(newHistory.length - 1);
      }

      return newHistory;
    });
  }, [currentIndex, maxHistorySize]);

  /**
   * Undo to previous state
   * @returns {any | null} Previous state or null if can't undo
   */
  const undo = useCallback(() => {
    if (currentIndex <= 0) return null;

    isInternalUpdate.current = true;
    const newIndex = currentIndex - 1;
    setCurrentIndex(newIndex);

    const prevState = history[newIndex].state;

    // Reset flag after a tick
    setTimeout(() => {
      isInternalUpdate.current = false;
    }, 0);

    return prevState;
  }, [currentIndex, history]);

  /**
   * Redo to next state
   * @returns {any | null} Next state or null if can't redo
   */
  const redo = useCallback(() => {
    if (currentIndex >= history.length - 1) return null;

    isInternalUpdate.current = true;
    const newIndex = currentIndex + 1;
    setCurrentIndex(newIndex);

    const nextState = history[newIndex].state;

    // Reset flag after a tick
    setTimeout(() => {
      isInternalUpdate.current = false;
    }, 0);

    return nextState;
  }, [currentIndex, history]);

  /**
   * Clear all history
   */
  const clear = useCallback(() => {
    setHistory([]);
    setCurrentIndex(-1);
  }, []);

  const canUndo = currentIndex > 0;
  const canRedo = currentIndex < history.length - 1;

  return {
    push,
    undo,
    redo,
    canUndo,
    canRedo,
    clear,
    currentIndex,
    historySize: history.length
  };
}
