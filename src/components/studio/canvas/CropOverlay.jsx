"use client";
import { Circle, Group, Line, Path } from "react-konva";
import { CROP_PATHS } from "@/lib/studio/crop-geometry";

export default function CropOverlay({ rect, shape, grid, onGrid, scale = 1, accent }) {
  if (shape !== "grid") return CROP_PATHS[shape] ? <Path data={CROP_PATHS[shape]} x={rect.left} y={rect.top} scaleX={rect.width / 100} scaleY={rect.height / 100} stroke={accent} strokeWidth={150 / Math.max(rect.width, rect.height) / scale} fill={`${accent}18`} listening={false} /> : null;
  const stroke = 1 / scale;
  function drag(event, xIndex, yIndex) {
    const x = [...grid.x], y = [...grid.y];
    x[xIndex] = Math.max((x[xIndex - 1] || 0) + .02, Math.min((x[xIndex + 1] || 1) - .02, (event.target.x() - rect.left) / rect.width));
    y[yIndex] = Math.max((y[yIndex - 1] || 0) + .02, Math.min((y[yIndex + 1] || 1) - .02, (event.target.y() - rect.top) / rect.height));
    event.target.position({ x: rect.left + x[xIndex] * rect.width, y: rect.top + y[yIndex] * rect.height });
    onGrid({ x, y });
  }
  return <Group>
    {grid.x.map((x, i) => <Line key={`x${i}`} points={[rect.left + x * rect.width, rect.top, rect.left + x * rect.width, rect.top + rect.height]} stroke={accent} strokeWidth={stroke} listening={false} />)}
    {grid.y.map((y, i) => <Line key={`y${i}`} points={[rect.left, rect.top + y * rect.height, rect.left + rect.width, rect.top + y * rect.height]} stroke={accent} strokeWidth={stroke} listening={false} />)}
    {grid.x.flatMap((x, i) => grid.y.map((y, j) => <Circle key={`${i}-${j}`} x={rect.left + x * rect.width} y={rect.top + y * rect.height} radius={5 / scale} stroke={accent} strokeWidth={stroke} fill="white" draggable onMouseDown={e => { e.cancelBubble = true; }} onTouchStart={e => { e.cancelBubble = true; }} onDragMove={e => { e.cancelBubble = true; drag(e, i, j); }} onDragEnd={e => { e.cancelBubble = true; drag(e, i, j); }} />))}
  </Group>;
}
