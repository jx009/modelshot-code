"use client";
import { Fragment } from "react";
import { Circle, Group, Line, Path, Rect, Shape } from "react-konva";
import { CROP_PATHS } from "@/lib/studio/crop-geometry";

function shapeShade(context, rect, shape, width, height) {
  const canvas = context._context;
  canvas.save();
  canvas.beginPath();
  canvas.rect(0, 0, width, height);
  const x = value => rect.left + value * rect.width / 100;
  const y = value => rect.top + value * rect.height / 100;
  if (shape === "ellipse") {
    canvas.ellipse(x(50), y(50), rect.width / 2, rect.height / 2, 0, 0, Math.PI * 2);
  } else if (shape === "triangle") {
    canvas.moveTo(x(50), y(0)); canvas.lineTo(x(100), y(100)); canvas.lineTo(x(0), y(100)); canvas.closePath();
  } else {
    canvas.moveTo(x(50), y(96));
    canvas.bezierCurveTo(x(40), y(84), x(0), y(60), x(0), y(29));
    canvas.bezierCurveTo(x(0), y(-2), x(35), y(-10), x(50), y(17));
    canvas.bezierCurveTo(x(65), y(-10), x(100), y(-2), x(100), y(29));
    canvas.bezierCurveTo(x(100), y(60), x(60), y(84), x(50), y(96)); canvas.closePath();
  }
  canvas.fillStyle = "rgba(8, 9, 13, 0.97)";
  canvas.fill("evenodd");
  canvas.restore();
}

function RectShade({ rect, width, height }) {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  const shade = { fill: "#08090d", opacity: 0.97, listening: false };
  return <>
    <Rect x={0} y={0} width={width} height={Math.max(0, rect.top)} {...shade} />
    <Rect x={0} y={rect.top + rect.height} width={width} height={Math.max(0, height - rect.top - rect.height)} {...shade} />
    <Rect x={0} y={rect.top} width={Math.max(0, rect.left)} height={rect.height} {...shade} />
    <Rect x={rect.left + rect.width} y={rect.top} width={Math.max(0, width - rect.left - rect.width)} height={rect.height} {...shade} />
  </>;
}

export default function CropOverlay({ rect, shape, grid, onGrid, scale = 1, accent, canvasWidth, canvasHeight }) {
  if (shape !== "grid") return CROP_PATHS[shape] ? <Group>
    {Number.isFinite(canvasWidth) && Number.isFinite(canvasHeight) && <Shape sceneFunc={context => shapeShade(context, rect, shape, canvasWidth, canvasHeight)} listening={false} />}
    <Path data={CROP_PATHS[shape]} x={rect.left} y={rect.top} scaleX={rect.width / 100} scaleY={rect.height / 100} stroke={accent} strokeWidth={150 / Math.max(rect.width, rect.height) / scale} listening={false} />
  </Group> : <RectShade rect={rect} width={canvasWidth} height={canvasHeight} />;
  // The dark under-stroke keeps orange guides visible on both light and dark photos.
  const stroke = 3 / Math.max(scale, 0.01);
  const underStroke = 7 / Math.max(scale, 0.01);
  function drag(event, xIndex, yIndex) {
    const x = [...grid.x], y = [...grid.y];
    x[xIndex] = Math.max((x[xIndex - 1] || 0) + .02, Math.min((x[xIndex + 1] || 1) - .02, (event.target.x() - rect.left) / rect.width));
    y[yIndex] = Math.max((y[yIndex - 1] || 0) + .02, Math.min((y[yIndex + 1] || 1) - .02, (event.target.y() - rect.top) / rect.height));
    event.target.position({ x: rect.left + x[xIndex] * rect.width, y: rect.top + y[yIndex] * rect.height });
    onGrid({ x, y });
  }
  return <Group>
    <RectShade rect={rect} width={canvasWidth} height={canvasHeight} />
    {grid.x.map((x, i) => <Fragment key={`grid-x-${i}`}>
      <Line key={`ux${i}`} points={[rect.left + x * rect.width, rect.top, rect.left + x * rect.width, rect.top + rect.height]} stroke="#111318" strokeWidth={underStroke} opacity={0.9} listening={false} />
      <Line key={`x${i}`} points={[rect.left + x * rect.width, rect.top, rect.left + x * rect.width, rect.top + rect.height]} stroke={accent} strokeWidth={stroke} listening={false} />
    </Fragment>)}
    {grid.y.map((y, i) => <Fragment key={`grid-y-${i}`}>
      <Line key={`uy${i}`} points={[rect.left, rect.top + y * rect.height, rect.left + rect.width, rect.top + y * rect.height]} stroke="#111318" strokeWidth={underStroke} opacity={0.9} listening={false} />
      <Line key={`y${i}`} points={[rect.left, rect.top + y * rect.height, rect.left + rect.width, rect.top + y * rect.height]} stroke={accent} strokeWidth={stroke} listening={false} />
    </Fragment>)}
    {grid.x.flatMap((x, i) => grid.y.map((y, j) => <Fragment key={`grid-point-${i}-${j}`}>
      <Circle key={`shadow-${i}-${j}`} x={rect.left + x * rect.width} y={rect.top + y * rect.height} radius={9 / scale} fill="#111318" opacity={0.9} listening={false} />
      <Circle key={`${i}-${j}`} x={rect.left + x * rect.width} y={rect.top + y * rect.height} radius={7 / scale} stroke={accent} strokeWidth={stroke} fill="white" draggable onMouseDown={e => { e.cancelBubble = true; }} onTouchStart={e => { e.cancelBubble = true; }} onDragMove={e => { e.cancelBubble = true; drag(e, i, j); }} onDragEnd={e => { e.cancelBubble = true; drag(e, i, j); }} />
    </Fragment>))}
  </Group>;
}
