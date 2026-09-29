export function regionCorners(region) {
  const angle = (region.rotation || 0) * Math.PI / 180;
  return [[0, 0], [region.width, 0], [region.width, region.height], [0, region.height]].map(([x, y]) => ({
    x: region.left + x * Math.cos(angle) - y * Math.sin(angle),
    y: region.top + x * Math.sin(angle) + y * Math.cos(angle),
  }));
}

export function regionBounds(region) {
  const corners = regionCorners(region);
  const left = Math.floor(Math.min(...corners.map(p => p.x))), top = Math.floor(Math.min(...corners.map(p => p.y)));
  return { left, top, width: Math.ceil(Math.max(...corners.map(p => p.x))) - left, height: Math.ceil(Math.max(...corners.map(p => p.y))) - top };
}

export function regionInside(region, width, height) {
  return region && region.width >= 3 && region.height >= 3 && regionCorners(region).every(p => p.x >= -0.01 && p.y >= -0.01 && p.x <= width + 0.01 && p.y <= height + 0.01);
}

export function containRegion(region, width, height) {
  const box = regionBounds(region);
  if (box.width > width || box.height > height) return null;
  return { ...region, left: region.left - Math.min(0, box.left) - Math.max(0, box.left + box.width - width), top: region.top - Math.min(0, box.top) - Math.max(0, box.top + box.height - height) };
}
