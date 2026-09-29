"use client";

import { useEffect, useRef, useState } from "react";
import { Group, Rect, Line, Transformer, Text } from "react-konva";
import { containRegion, regionCorners } from "@/lib/studio/move-geometry";

function Region({ value, active, onActivate, onChange, width, height, scale, label }) {
  const shape = useRef(null), transformer = useRef(null);
  useEffect(() => { if (active && transformer.current) { transformer.current.nodes([shape.current]); transformer.current.getLayer()?.batchDraw(); } }, [active]);
  function commit(node) {
    const next = containRegion({ left: Math.round(node.x()), top: Math.round(node.y()), width: Math.max(3, Math.round(node.width() * node.scaleX())), height: Math.max(3, Math.round(node.height() * node.scaleY())), rotation: Math.round(node.rotation()) }, width, height) || value;
    node.scale({ x: 1, y: 1 }); node.position({ x: next.left, y: next.top }); node.size({ width: next.width, height: next.height }); node.rotation(next.rotation || 0);
    onChange(next);
  }
  return <>
    <Rect ref={shape} x={value.left} y={value.top} width={value.width} height={value.height} rotation={value.rotation || 0}
      stroke="white" strokeWidth={1.5 / scale} dash={active ? [] : [6 / scale, 5 / scale]} fill="#ffffff02" draggable
      onMouseDown={onActivate} onTouchStart={onActivate} onDragMove={e => commit(e.target)} onTransformEnd={e => commit(e.target)} />
    <Text x={value.left} y={value.top - 20 / scale} text={label} fontSize={12 / scale} fill="white" listening={false} />
    {active && <Transformer ref={transformer} flipEnabled={false} keepRatio={false} rotateEnabled rotateAnchorOffset={25}
      borderStroke="white" anchorStroke="#b5bdff" anchorFill="white" anchorSize={9} anchorCornerRadius={5}
      boundBoxFunc={(old, next) => next.width < 3 || next.height < 3 ? old : next} />}
  </>;
}

export default function MoveRegions({ source, target, width, height, scale, onChange, zh }) {
  const [active, setActive] = useState("target");
  const from = regionCorners(source), to = regionCorners(target);
  return <Group>
    <Rect width={width} height={height} fill="black" opacity={0.28} listening={false} />
    {[source, target].map((r, i) => <Rect key={i} x={r.left} y={r.top} width={r.width} height={r.height} rotation={r.rotation || 0} fill="black" globalCompositeOperation="destination-out" listening={false} />)}
    {from.map((p, i) => <Line key={i} points={[p.x, p.y, to[i].x, to[i].y]} stroke="white" opacity={0.55} strokeWidth={1 / scale} dash={[5 / scale, 4 / scale]} listening={false} />)}
    <Region value={source} active={active === "source"} onActivate={() => setActive("source")} onChange={r => onChange({ moveSource: r })} width={width} height={height} scale={scale} label={zh ? "源区域" : "Source"} />
    <Region value={target} active={active === "target"} onActivate={() => setActive("target")} onChange={r => onChange({ moveTarget: r })} width={width} height={height} scale={scale} label={zh ? "目标区域" : "Destination"} />
  </Group>;
}
