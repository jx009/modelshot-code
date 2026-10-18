export const DEFAULT_PREVIEW_VIEW = Object.freeze({ zoom: .75, x: 0, y: 0, rotation: 0, flipX: false, flipY: false });
export const MIN_PREVIEW_ZOOM = .1;
export const MAX_PREVIEW_ZOOM = 8;

// Anchor is relative to the viewport center, in screen pixels. Keeping that
// point stationary lets the wheel zoom into the detail under the cursor.
export function zoomPreview(view, zoom, anchor = { x: 0, y: 0 }) {
  const next = Math.max(MIN_PREVIEW_ZOOM, Math.min(MAX_PREVIEW_ZOOM, zoom));
  const ratio = next / view.zoom;
  return { ...view, zoom: next, x: anchor.x - (anchor.x - view.x) * ratio, y: anchor.y - (anchor.y - view.y) * ratio };
}
