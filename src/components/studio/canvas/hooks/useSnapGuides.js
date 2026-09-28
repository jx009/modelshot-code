import { useMemo } from "react";

/**
 * Calculate snap guides for object alignment
 * @param {Array} layers - All canvas layers
 * @param {string} movingId - ID of the layer being moved
 * @param {{x: number, y: number, width: number, height: number}} movingBounds - Bounds of moving object
 * @param {number} snapThreshold - Distance threshold for snapping (default 8px)
 * @returns {{
 *   snapX: number | null,
 *   snapY: number | null,
 *   guides: Array<{type: string, position: number, axis: 'x' | 'y'}>
 * }}
 */
export function useSnapGuides(layers, movingId, movingBounds, snapThreshold = 8) {
  return useMemo(() => {
    if (!movingBounds || !layers || layers.length === 0) {
      return { snapX: null, snapY: null, guides: [] };
    }

    // Get stationary objects (exclude moving object)
    const stationaryLayers = layers.filter(l => l.id !== movingId && l.visible);

    if (stationaryLayers.length === 0) {
      return { snapX: null, snapY: null, guides: [] };
    }

    // Calculate moving object edges and center
    const moving = {
      left: movingBounds.x,
      right: movingBounds.x + movingBounds.width,
      centerX: movingBounds.x + movingBounds.width / 2,
      top: movingBounds.y,
      bottom: movingBounds.y + movingBounds.height,
      centerY: movingBounds.y + movingBounds.height / 2
    };

    let snapX = null;
    let snapY = null;
    const guides = [];

    // Find closest snap points
    let closestXDist = Infinity;
    let closestYDist = Infinity;

    stationaryLayers.forEach(layer => {
      const target = {
        left: layer.x,
        right: layer.x + layer.width,
        centerX: layer.x + layer.width / 2,
        top: layer.y,
        bottom: layer.y + layer.height,
        centerY: layer.y + layer.height / 2
      };

      // Check horizontal alignment points
      const xAlignments = [
        { movingEdge: moving.left, targetEdge: target.left, type: "left" },
        { movingEdge: moving.left, targetEdge: target.right, type: "left-right" },
        { movingEdge: moving.left, targetEdge: target.centerX, type: "left-center" },
        { movingEdge: moving.right, targetEdge: target.right, type: "right" },
        { movingEdge: moving.right, targetEdge: target.left, type: "right-left" },
        { movingEdge: moving.right, targetEdge: target.centerX, type: "right-center" },
        { movingEdge: moving.centerX, targetEdge: target.centerX, type: "center" },
        { movingEdge: moving.centerX, targetEdge: target.left, type: "center-left" },
        { movingEdge: moving.centerX, targetEdge: target.right, type: "center-right" }
      ];

      xAlignments.forEach(({ movingEdge, targetEdge, type }) => {
        const dist = Math.abs(movingEdge - targetEdge);
        if (dist < closestXDist && dist <= snapThreshold) {
          closestXDist = dist;
          snapX = targetEdge - (movingEdge - moving.left);
          guides.push({ type, position: targetEdge, axis: 'x' });
        }
      });

      // Check vertical alignment points
      const yAlignments = [
        { movingEdge: moving.top, targetEdge: target.top, type: "top" },
        { movingEdge: moving.top, targetEdge: target.bottom, type: "top-bottom" },
        { movingEdge: moving.top, targetEdge: target.centerY, type: "top-center" },
        { movingEdge: moving.bottom, targetEdge: target.bottom, type: "bottom" },
        { movingEdge: moving.bottom, targetEdge: target.top, type: "bottom-top" },
        { movingEdge: moving.bottom, targetEdge: target.centerY, type: "bottom-center" },
        { movingEdge: moving.centerY, targetEdge: target.centerY, type: "center" },
        { movingEdge: moving.centerY, targetEdge: target.top, type: "center-top" },
        { movingEdge: moving.centerY, targetEdge: target.bottom, type: "center-bottom" }
      ];

      yAlignments.forEach(({ movingEdge, targetEdge, type }) => {
        const dist = Math.abs(movingEdge - targetEdge);
        if (dist < closestYDist && dist <= snapThreshold) {
          closestYDist = dist;
          snapY = targetEdge - (movingEdge - moving.top);
          guides.push({ type, position: targetEdge, axis: 'y' });
        }
      });
    });

    // Remove duplicate guides
    const uniqueGuides = guides.filter((guide, index, self) =>
      index === self.findIndex(g => g.axis === guide.axis && g.position === guide.position)
    );

    return { snapX, snapY, guides: uniqueGuides };
  }, [layers, movingId, movingBounds, snapThreshold]);
}

/**
 * Apply snap adjustments to position
 * @param {{x: number, y: number}} position - Original position
 * @param {{snapX: number | null, snapY: number | null}} snap - Snap positions
 * @returns {{x: number, y: number}} Adjusted position
 */
export function applySnap(position, snap) {
  return {
    x: snap.snapX !== null ? snap.snapX : position.x,
    y: snap.snapY !== null ? snap.snapY : position.y
  };
}
