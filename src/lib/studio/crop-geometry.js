export const CROP_PATHS = {
  ellipse: "M 50 0 A 50 50 0 1 1 50 100 A 50 50 0 1 1 50 0 Z",
  triangle: "M 50 0 L 100 100 L 0 100 Z",
  heart: "M 50 96 C 40 84 0 60 0 29 C 0 -2 35 -10 50 17 C 65 -10 100 -2 100 29 C 100 60 60 84 50 96 Z",
};
export function cropCells(rect, grid) {
  if (!grid) return [rect];
  const xs = [0, ...grid.x, 1].map(value => Math.round(value * rect.width));
  const ys = [0, ...grid.y, 1].map(value => Math.round(value * rect.height));
  return ys.slice(0, -1).flatMap((top, row) => xs.slice(0, -1).map((left, col) => ({ left: rect.left + left, top: rect.top + top, width: xs[col + 1] - left, height: ys[row + 1] - top })));
}
export function ratioCrop(width, height, ratio) {
  const w = Math.round(Math.min(width, height * ratio)), h = Math.round(w / ratio);
  return { left: Math.floor((width - w) / 2), top: Math.floor((height - h) / 2), width: Math.max(1, w), height: Math.max(1, h) };
}
