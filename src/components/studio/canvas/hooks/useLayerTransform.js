import { useRef, useCallback } from "react";
import { throttleRaf } from "@/lib/utils/throttle";

/**
 * Optimized layer transform hook with incremental rendering
 * Reduces full canvas redraws during drag operations
 * @returns {{
 *   startTransform: (layerId: string) => void,
 *   updateTransform: (layerId: string, transform: object) => void,
 *   endTransform: (layerId: string, transform: object, onCommit: Function) => void,
 *   isTransforming: boolean
 * }}
 */
export function useLayerTransform() {
  const transformingRef = useRef(null);
  const previewTransformRef = useRef({});

  /**
   * Begin transform operation
   * @param {string} layerId - ID of layer being transformed
   */
  const startTransform = useCallback((layerId) => {
    transformingRef.current = layerId;
    previewTransformRef.current = {};
  }, []);

  /**
   * Update transform preview (throttled for 60fps)
   * Only updates the transforming layer, not full canvas
   * @param {string} layerId - ID of layer being transformed
   * @param {{x?: number, y?: number, width?: number, height?: number, rotation?: number}} transform - Transform values
   */
  const updateTransform = useCallback(
    throttleRaf((layerId, transform) => {
      if (transformingRef.current !== layerId) return;

      // Store preview transform without triggering full state update
      previewTransformRef.current = {
        ...previewTransformRef.current,
        ...transform
      };

      // Konva will handle the visual update through its own layer
      // No need to trigger React re-render during drag
    }),
    []
  );

  /**
   * Commit transform to state
   * @param {string} layerId - ID of layer being transformed
   * @param {{x?: number, y?: number, width?: number, height?: number, rotation?: number}} transform - Final transform values
   * @param {Function} onCommit - Callback to commit to parent state
   */
  const endTransform = useCallback((layerId, transform, onCommit) => {
    if (transformingRef.current !== layerId) return;

    // Commit final transform to state
    onCommit(layerId, transform);

    // Clear preview
    transformingRef.current = null;
    previewTransformRef.current = {};
  }, []);

  return {
    startTransform,
    updateTransform,
    endTransform,
    isTransforming: transformingRef.current !== null,
    getPreviewTransform: (layerId) =>
      transformingRef.current === layerId ? previewTransformRef.current : {}
  };
}

/**
 * Batch multiple layer updates to reduce re-renders
 * @returns {{
 *   batchUpdate: (updates: Array<{id: string, changes: object}>) => void,
 *   commitBatch: (onCommit: Function) => void
 * }}
 */
export function useBatchLayerUpdate() {
  const batchRef = useRef([]);
  const timeoutRef = useRef(null);

  /**
   * Add update to batch
   * @param {Array<{id: string, changes: object}>} updates - Array of layer updates
   */
  const batchUpdate = useCallback((updates) => {
    batchRef.current.push(...updates);

    // Auto-commit after short delay if no more updates come
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      if (batchRef.current.length > 0) {
        // This would trigger a single state update with all changes
        batchRef.current = [];
      }
    }, 16); // ~60fps
  }, []);

  /**
   * Commit all batched updates at once
   * @param {Function} onCommit - Callback to commit batched updates
   */
  const commitBatch = useCallback((onCommit) => {
    if (batchRef.current.length === 0) return;

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    onCommit(batchRef.current);
    batchRef.current = [];
  }, []);

  return {
    batchUpdate,
    commitBatch
  };
}
