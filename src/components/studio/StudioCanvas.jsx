"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Stage, Layer, Image as CanvasImage, Transformer, Text, Group, Line, Rect } from "react-konva";

function Picture({ item, selected, onSelect, onChange, interactive, accent, onError }) {
  const [image, setImage] = useState(null);
  const shape = useRef(null), transformer = useRef(null);
  useEffect(() => {
    if (item.type !== "image") return;
    let live = true;
    const img = new window.Image();
    img.onload = () => { if (live) setImage(img); };
    img.onerror = () => { if (live) onError("IMAGE_LOAD_FAILED"); };
    img.src = `/api/assets/${item.assetId}`;
    return () => { live = false; };
  }, [item.assetId, item.type, onError]);
  useEffect(() => { if (selected && transformer.current && shape.current) { transformer.current.nodes([shape.current]); transformer.current.getLayer().batchDraw(); } }, [selected, interactive]);
  const props = { ref: shape, id: item.id, x: item.x, y: item.y, width: item.width, height: item.height, rotation: item.rotation || 0, opacity: item.opacity ?? 1, draggable: interactive,
    onClick: onSelect, onTap: onSelect, onDragEnd: e => onChange({ x: e.target.x(), y: e.target.y() }),
    onTransformEnd: () => { const node = shape.current; const width = Math.max(16, node.width() * node.scaleX()), height = Math.max(16, node.height() * node.scaleY()); node.scaleX(1); node.scaleY(1); onChange({ x: node.x(), y: node.y(), width, height, rotation: node.rotation() }); } };
  return <>
    {item.type === "image" ? <CanvasImage {...props} image={image} /> : item.type === "text" ? <Text {...props} text={item.text || ""} fontSize={item.fontSize || 36} fill={item.fill || accent} fontFamily="Arial, sans-serif" /> : <Group {...props}><Rect width={item.width} height={item.height} fill={accent} opacity={0.13} cornerRadius={12} /><Text text="▶  VIDEO" width={item.width} align="center" y={item.height / 2 - 10} fill={accent} fontSize={22} /></Group>}
    {selected && interactive && <Transformer ref={transformer} flipEnabled={false} borderStroke={accent} anchorStroke={accent} anchorFill={accent} anchorSize={8} anchorCornerRadius={4} padding={3} boundBoxFunc={(old, next) => next.width < 16 || next.height < 16 || next.width > 8192 || next.height > 8192 ? old : next} />}
  </>;
}

const StudioCanvas = forwardRef(function StudioCanvas({ layers, selectedId, onSelect, onChange, mode, brushSize = 35, onCrop, onZoom, onUpload, onError, label }, ref) {
  const container = useRef(null), stage = useRef(null), artwork = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [camera, setCamera] = useState({ x: 30, y: 20, scale: 1 });
  const [strokes, setStrokes] = useState([]), [crop, setCrop] = useState(null);
  const [color, setColor] = useState("#D9F154");
  const drawing = useRef(false), cropStart = useRef(null), activeStroke = useRef(null);
  const selection = layers.find(l => l.id === selectedId);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setDimensions({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(container.current);
    setColor(getComputedStyle(container.current).getPropertyValue("--primary").trim() || "#D9F154");
    return () => observer.disconnect();
  }, []);
  useEffect(() => { onZoom(camera.scale); }, [camera.scale, onZoom]);
  const toolKey = `${selectedId}:${mode}`;
  useEffect(() => { activeStroke.current = null; drawing.current = false; }, [toolKey]);
  function updateCamera(next) { setCamera(current => ({ ...current, ...next })); }
  function zoom(factor) {
    setCamera(c => {
      const scale = Math.min(4, Math.max(0.08, c.scale * factor)), center = { x: dimensions.width / 2, y: dimensions.height / 2 };
      return { scale, x: center.x - (center.x - c.x) / c.scale * scale, y: center.y - (center.y - c.y) / c.scale * scale };
    });
  }
  function fit() {
    const visible = layers.filter(l => l.visible);
    if (!visible.length) { setCamera({ x: 30, y: 20, scale: 1 }); return; }
    const left = Math.min(...visible.map(l => l.x)), top = Math.min(...visible.map(l => l.y));
    const right = Math.max(...visible.map(l => l.x + l.width)), bottom = Math.max(...visible.map(l => l.y + l.height));
    const width = right - left, height = bottom - top;
    const scale = Math.max(0.08, Math.min(1.5, (dimensions.width - 110) / width, (dimensions.height - 180) / height));
    setCamera({ scale, x: (dimensions.width - width * scale) / 2 - left * scale, y: (dimensions.height - height * scale) / 2 - top * scale });
  }
  useImperativeHandle(ref, () => ({ zoom, fit,
    clearMask: () => { setStrokes([]); setCrop(null); },
    async maskBlob(rectangle) {
      if (!selection) throw new Error("Select an image");
      const canvas = document.createElement("canvas");
      canvas.width = selection.pixelWidth; canvas.height = selection.pixelHeight;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "black"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = "white"; ctx.fillStyle = "white"; ctx.lineCap = "round"; ctx.lineJoin = "round";
      if (rectangle) ctx.fillRect(rectangle.left, rectangle.top, rectangle.width, rectangle.height);
      else {
        const lines = strokes.filter(s => s.target === toolKey);
        if (!lines.length) throw new Error("请先在图片上涂抹 / Paint a mask first");
        for (const stroke of lines) {
          ctx.lineWidth = stroke.width; ctx.beginPath();
          for (let i = 0; i < stroke.points.length; i += 2) { if (i === 0) ctx.moveTo(stroke.points[i], stroke.points[i + 1]); else ctx.lineTo(stroke.points[i], stroke.points[i + 1]); }
          ctx.stroke(); ctx.beginPath(); ctx.arc(stroke.points[0], stroke.points[1], stroke.width / 2, 0, Math.PI * 2); ctx.fill();
        }
      }
      return new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    },
    async exportPNG() {
      const visible = layers.filter(l => l.visible && l.type !== "video");
      if (!visible.length) throw new Error("画布上没有图片 / No images on canvas");
      if (artwork.current.find("Image").some(node => !node.image()?.complete)) throw new Error("图片仍在加载，请稍后导出 / Images are still loading");
      const clone = artwork.current.clone();
      clone.find("Transformer").forEach(t => t.destroy());
      clone.scale({ x: 1, y: 1 }); clone.position({ x: 0, y: 0 });
      const rect = clone.getClientRect();
      const pixels = rect.width * rect.height;
      if (pixels > 40000000) { clone.destroy(); throw new Error("导出范围过大 / Export area is too large"); }
      const url = clone.toDataURL({ ...rect, pixelRatio: Math.min(2, Math.sqrt(40000000 / Math.max(1, pixels))) });
      clone.destroy();
      const anchor = document.createElement("a"); anchor.download = "modelshot-canvas.png"; anchor.href = url; anchor.click();
    },
  }));
  function point() {
    if (!selection || !stage.current) return null;
    const node = stage.current.findOne(`#${selectedId}`);
    if (!node) return null;
    const p = node.getAbsoluteTransform().copy().invert().point(stage.current.getPointerPosition());
    return { x: Math.max(0, Math.min(selection.pixelWidth, p.x / selection.width * selection.pixelWidth)), y: Math.max(0, Math.min(selection.pixelHeight, p.y / selection.height * selection.pixelHeight)) };
  }
  function down(e) {
    if (mode !== "mask" && mode !== "crop") { if (e.target === e.target.getStage()) onSelect(null); return; }
    const p = point(); if (!p) return;
    drawing.current = true;
    if (mode === "crop") { cropStart.current = p; setCrop(null); }
    else { const stroke = { target: toolKey, width: brushSize, points: [p.x, p.y, p.x + 0.1, p.y + 0.1] }; activeStroke.current = stroke; setStrokes(current => [...current, stroke]); }
  }
  function move() {
    if (!drawing.current) return;
    const p = point(); if (!p) return;
    if (mode === "crop") {
      const start = cropStart.current;
      if (!start) return;
      const rect = { left: Math.round(Math.min(p.x, start.x)), top: Math.round(Math.min(p.y, start.y)), width: Math.max(1, Math.floor(Math.abs(p.x - start.x))), height: Math.max(1, Math.floor(Math.abs(p.y - start.y))) };
      setCrop(rect); onCrop(rect);
    } else if (activeStroke.current) {
      activeStroke.current = { ...activeStroke.current, points: [...activeStroke.current.points, p.x, p.y] };
      setStrokes(current => [...current.slice(0, -1), activeStroke.current]);
    }
  }
  const editing = selection?.type === "image" && ["mask", "crop"].includes(mode);
  return <div ref={container} className={`ms-stage ${mode === "hand" ? "is-hand" : editing ? "is-brush" : ""}`} aria-label={label} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); onUpload(e.dataTransfer.files); }}>
    <Stage ref={stage} {...dimensions} x={camera.x} y={camera.y} scaleX={camera.scale} scaleY={camera.scale} draggable={mode === "hand"} onDragEnd={e => { if (e.target === stage.current) updateCamera({ x: e.target.x(), y: e.target.y() }); }}
      onWheel={e => { e.evt.preventDefault(); const pointer = stage.current.getPointerPosition(); const next = Math.max(0.08, Math.min(4, camera.scale * (e.evt.deltaY > 0 ? 0.93 : 1.07))); setCamera({ scale: next, x: pointer.x - (pointer.x - camera.x) / camera.scale * next, y: pointer.y - (pointer.y - camera.y) / camera.scale * next }); }}
      onMouseDown={down} onTouchStart={down} onMouseMove={move} onTouchMove={move} onMouseUp={() => { drawing.current = false; }} onTouchEnd={() => { drawing.current = false; }} onMouseLeave={() => { drawing.current = false; }}>
      <Layer ref={artwork}>
        {layers.filter(l => l.visible).map(item => <Picture key={item.id} item={item} selected={selectedId === item.id} interactive={mode === "select"} accent={color} onError={onError} onSelect={() => { if (!editing) onSelect(item.id); }} onChange={patch => { try { onChange(layers.map(l => l.id === item.id ? { ...l, ...patch } : l)); } catch (e) { onError(e); } }} />)}
      </Layer>
      {editing && <Layer listening={false}><Group x={selection.x} y={selection.y} rotation={selection.rotation} scaleX={selection.width / selection.pixelWidth} scaleY={selection.height / selection.pixelHeight} clipWidth={selection.pixelWidth} clipHeight={selection.pixelHeight}>
        {mode === "mask" && strokes.filter(s => s.target === toolKey).map((s, i) => <Line key={i} points={s.points} stroke={color} strokeWidth={s.width} opacity={0.55} lineCap="round" lineJoin="round" />)}
        {mode === "crop" && crop && <Rect x={crop.left} y={crop.top} width={crop.width} height={crop.height} stroke={color} strokeWidth={2 / camera.scale} dash={[8, 5]} />}
      </Group></Layer>}
    </Stage>
  </div>;
});
export default StudioCanvas;
