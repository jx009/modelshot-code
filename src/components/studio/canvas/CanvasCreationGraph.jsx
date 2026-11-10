"use client";

import { memo, useMemo } from "react";
import { Group, Layer, Path, Rect, Text } from "react-konva";
import { canvasVideoTasks, lineageEdges } from "@/lib/studio/canvas-lineage";

function edgePoint(layer, right) {
  const angle = (layer.rotation || 0) * Math.PI / 180;
  const x = right ? layer.width : 0, y = layer.height / 2;
  return { x: layer.x + x * Math.cos(angle) - y * Math.sin(angle), y: layer.y + x * Math.sin(angle) + y * Math.cos(angle) };
}

function taskLabel(node, zh) {
  if (node.cancelRequested || node.status === "cancel_requested") return zh ? "取消处理中" : "Cancellation requested";
  if (node.status === "queued") return zh ? "已提交，等待处理" : "Submitted · waiting";
  if (node.status === "reconciling") return zh ? "正在核对原任务状态" : "Recovering the original task";
  return zh ? "正在生成视频" : "Generating video";
}

export default memo(function CanvasCreationGraph({ layers, jobs, appliedJobs, taskPositions, selectedId, scale, camera, dimensions, light, zh }) {
  const pending = useMemo(() => canvasVideoTasks(layers, jobs, appliedJobs, taskPositions), [layers, jobs, appliedJobs, taskPositions]);
  const edges = useMemo(() => lineageEdges(layers, pending), [layers, pending]);
  const view = { left: -camera.x / scale - 100, top: -camera.y / scale - 100, right: (dimensions.width - camera.x) / scale + 100, bottom: (dimensions.height - camera.y) / scale + 100 };
  const intersects = (left, top, right, bottom) => left <= view.right && right >= view.left && top <= view.bottom && bottom >= view.top;
  return <Layer listening={false}>
    {edges.map(({ id, source, result }) => {
      const from = edgePoint(source, true), to = edgePoint(result, false);
      const bend = Math.max(40, Math.abs(to.x - from.x) * .45);
      if (!intersects(Math.min(from.x, to.x - bend), Math.min(from.y, to.y), Math.max(to.x, from.x + bend), Math.max(from.y, to.y))) return null;
      const selected = selectedId === source.id || selectedId === result.id;
      return <Path key={id} data={`M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`} stroke={selected ? "#35a9ba" : light ? "#8c9ca6" : "#4f6876"} strokeWidth={(selected ? 2 : 1) / scale} opacity={selected ? .9 : .42} />;
    })}
    {pending.filter(node => intersects(node.x, node.y, node.x + node.width, node.y + node.height)).map(node => <Group key={node.id} x={node.x} y={node.y}>
      <Rect width={node.width} height={node.height} cornerRadius={12} fill={light ? "#f2f3f5" : "#232326"} stroke={light ? "#d5d7dc" : "#424248"} strokeWidth={1 / scale} />
      <Text x={18} y={20} width={node.width - 36} text={zh ? "视频" : "Video"} fontSize={14} fill={light ? "#52525b" : "#b6b6bf"} />
      <Text x={18} y={86} width={node.width - 36} align="center" text={taskLabel(node, zh)} fontSize={16} fill={light ? "#27272a" : "#e8e8ec"} />
      <Text x={24} y={125} width={node.width - 48} align="center" text={zh ? "可以继续操作画布，结果将自动显示" : "Keep working. Your result will appear here."} fontSize={12} lineHeight={1.5} fill={light ? "#71717a" : "#a1a1aa"} />
    </Group>)}
  </Layer>;
});
