// Shared by the canvas preview and the worker: the displayed edit boundary is
// also the hard limit for compositing generated pixels back into the source.
export function editRegion(bounds, width, height, padding = 0.25) {
  const margin = Math.ceil(Math.max(bounds.width, bounds.height) * padding);
  const left = Math.max(0, bounds.left - margin), top = Math.max(0, bounds.top - margin);
  const right = Math.min(width, bounds.left + bounds.width + margin);
  const bottom = Math.min(height, bounds.top + bounds.height + margin);
  return { left, top, width: right - left, height: bottom - top };
}
