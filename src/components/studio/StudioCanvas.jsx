"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Stage, Layer, Image as CanvasImage, Transformer, Text, Group, Line, Rect } from "react-konva";

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

async function alphaMaskBlob(image, width, height) {
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height);
  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    const selected = pixels.data[offset + 3] > 16 ? 255 : 0;
    pixels.data[offset] = selected; pixels.data[offset + 1] = selected; pixels.data[offset + 2] = selected; pixels.data[offset + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  return new Promise(resolve => canvas.toBlob(resolve, "image/png"));
}

async function createCutout(assetId, maskBlob, width, height) {
  const form = new FormData();
  form.append("assetId", assetId);
  form.append("selection", maskBlob, "selection.png");
  const response = await fetch("/api/studio/segment", { method: "POST", body: form });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.code || "SEGMENTATION_FAILED");
  }
  const url = URL.createObjectURL(await response.blob());
  try {
    const image = await loadImage(url);
    return { image, mask: await alphaMaskBlob(image, width, height) };
  }
  finally { URL.revokeObjectURL(url); }
}

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

function CropBox({ value, width, height, accent, onChange }) {
  const shape = useRef(null), transformer = useRef(null);
  useEffect(() => { if (shape.current && transformer.current) { transformer.current.nodes([shape.current]); transformer.current.getLayer()?.batchDraw(); } }, []);
  function commit(node) {
    const next = {
      left: Math.round(Math.max(0, Math.min(width - 1, node.x()))),
      top: Math.round(Math.max(0, Math.min(height - 1, node.y()))),
      width: Math.round(Math.max(1, Math.min(width, node.width() * node.scaleX()))),
      height: Math.round(Math.max(1, Math.min(height, node.height() * node.scaleY()))),
    };
    next.width = Math.min(next.width, width - next.left); next.height = Math.min(next.height, height - next.top);
    node.scale({ x: 1, y: 1 }); node.position({ x: next.left, y: next.top }); node.size({ width: next.width, height: next.height });
    onChange(next);
  }
  return <><Rect ref={shape} x={value.left} y={value.top} width={value.width} height={value.height} stroke={accent} strokeWidth={2} dash={[10, 6]} fill={`${accent}18`} draggable
    onDragMove={event => commit(event.target)} onTransformEnd={event => commit(event.target)} />
    <Transformer ref={transformer} rotateEnabled={false} flipEnabled={false} anchorFill={accent} anchorStroke={accent} borderStroke={accent} anchorSize={9}
      enabledAnchors={["top-left", "top-center", "top-right", "middle-left", "middle-right", "bottom-left", "bottom-center", "bottom-right"]} /></>;
}

function paddingEdges(value) { return typeof value === "number" ? { left: value, right: value, top: value, bottom: value } : value; }
function ExpansionBox({ value, width, height, accent, onChange }) {
  const shape = useRef(null), transformer = useRef(null), edges = paddingEdges(value);
  useEffect(() => { if (shape.current && transformer.current) { transformer.current.nodes([shape.current]); transformer.current.getLayer()?.batchDraw(); } }, []);
  function commit(node) {
    const x = node.x(), y = node.y(), boxWidth = node.width() * node.scaleX(), boxHeight = node.height() * node.scaleY();
    const next = {
      left: Math.round(Math.max(0, Math.min(1024, -x))), top: Math.round(Math.max(0, Math.min(1024, -y))),
      right: Math.round(Math.max(0, Math.min(1024, x + boxWidth - width))), bottom: Math.round(Math.max(0, Math.min(1024, y + boxHeight - height))),
    };
    node.scale({ x: 1, y: 1 }); onChange(next);
  }
  return <><Rect ref={shape} x={-edges.left} y={-edges.top} width={width + edges.left + edges.right} height={height + edges.top + edges.bottom}
    stroke={accent} strokeWidth={2} dash={[10, 6]} fill={`${accent}0D`} onTransformEnd={event => commit(event.target)} />
    <Transformer ref={transformer} rotateEnabled={false} flipEnabled={false} keepRatio={false} anchorFill={accent} anchorStroke={accent} borderStroke={accent} anchorSize={10}
      enabledAnchors={["top-left", "top-center", "top-right", "middle-left", "middle-right", "bottom-left", "bottom-center", "bottom-right"]} /></>;
}

const StudioCanvas = forwardRef(function StudioCanvas({ layers, selectedId, onSelect, onChange, mode, brushSize = 35, moveOffset = { dx: 0, dy: 0 }, onMoveOffset, onMovePreparing, onMoveReady, onMoveFailed, onCrop, expandPadding = 256, onExpandPadding, onZoom, onUpload, onError, label }, ref) {
  const container = useRef(null), stage = useRef(null), artwork = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [camera, setCamera] = useState({ x: 30, y: 20, scale: 1 });
  const [strokes, setStrokes] = useState([]), [crop, setCrop] = useState(null), [movePreview, setMovePreview] = useState(null), [moveSelection, setMoveSelection] = useState(null), [moveMask, setMoveMask] = useState(null);
  const [color, setColor] = useState("#D9F154");
  const drawing = useRef(false), cropStart = useRef(null), activeStroke = useRef(null), activeMove = useRef(null), moveMaskRef = useRef(null), expansionTarget = useRef(null);
  const selection = layers.find(l => l.id === selectedId);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setDimensions({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(container.current);
    setColor(getComputedStyle(container.current).getPropertyValue("--primary").trim() || "#D9F154");
    return () => observer.disconnect();
  }, []);
  useEffect(() => { onZoom(camera.scale); }, [camera.scale, onZoom]);
  const maskKey = `${selectedId}:mask`;
  const toolKey = `${selectedId}:${mode}`;
  useEffect(() => { activeStroke.current = null; drawing.current = false; }, [toolKey]);
  useEffect(() => { moveMaskRef.current = moveMask; }, [moveMask]);
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
  function fitExpansion() {
    if (!selection?.pixelWidth || !selection?.pixelHeight) return;
    const edges = paddingEdges(expandPadding);
    const scaleX = selection.width / selection.pixelWidth, scaleY = selection.height / selection.pixelHeight;
    const left = selection.x - edges.left * scaleX, top = selection.y - edges.top * scaleY;
    const width = selection.width + (edges.left + edges.right) * scaleX;
    const height = selection.height + (edges.top + edges.bottom) * scaleY;
    const scale = Math.max(0.08, Math.min(1.5, (dimensions.width - 110) / width, (dimensions.height - 180) / height));
    setCamera({ scale, x: (dimensions.width - width * scale) / 2 - left * scale, y: (dimensions.height - height * scale) / 2 - top * scale });
  }
  useEffect(() => {
    if (mode !== "expand" || !selection?.pixelWidth || !selection?.pixelHeight) { expansionTarget.current = null; return; }
    if (expansionTarget.current === selectedId) return;
    expansionTarget.current = selectedId;
    const edges = paddingEdges(expandPadding);
    const scaleX = selection.width / selection.pixelWidth, scaleY = selection.height / selection.pixelHeight;
    const left = selection.x - edges.left * scaleX, top = selection.y - edges.top * scaleY;
    const width = selection.width + (edges.left + edges.right) * scaleX;
    const height = selection.height + (edges.top + edges.bottom) * scaleY;
    const scale = Math.max(0.08, Math.min(1.5, (dimensions.width - 110) / width, (dimensions.height - 180) / height));
    setCamera({ scale, x: (dimensions.width - width * scale) / 2 - left * scale, y: (dimensions.height - height * scale) / 2 - top * scale });
  }, [mode, selectedId, selection, expandPadding, dimensions.width, dimensions.height]);
  async function maskBlob(rectangle, polygon) {
      if (!selection) throw new Error("Select an image");
      const canvas = document.createElement("canvas");
      canvas.width = selection.pixelWidth; canvas.height = selection.pixelHeight;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "black"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = "white"; ctx.fillStyle = "white"; ctx.lineCap = "round"; ctx.lineJoin = "round";
      const direct = rectangle || polygon ? { rectangle, polygon } : moveMaskRef.current;
      if (direct?.blob) return direct.blob;
      if (direct?.rectangle) ctx.fillRect(direct.rectangle.left, direct.rectangle.top, direct.rectangle.width, direct.rectangle.height);
      else if (direct?.polygon?.length >= 6) {
        ctx.beginPath(); ctx.moveTo(direct.polygon[0], direct.polygon[1]);
        for (let i = 2; i < direct.polygon.length; i += 2) ctx.lineTo(direct.polygon[i], direct.polygon[i + 1]);
        ctx.closePath(); ctx.fill();
      } else {
        const lines = strokes.filter(s => s.target === maskKey);
        if (!lines.length) throw new Error("请先在图片上涂抹 / Paint a mask first");
        for (const stroke of lines) {
          ctx.lineWidth = stroke.width; ctx.beginPath();
          for (let i = 0; i < stroke.points.length; i += 2) { if (i === 0) ctx.moveTo(stroke.points[i], stroke.points[i + 1]); else ctx.lineTo(stroke.points[i], stroke.points[i + 1]); }
          ctx.stroke(); ctx.beginPath(); ctx.arc(stroke.points[0], stroke.points[1], stroke.width / 2, 0, Math.PI * 2); ctx.fill();
        }
      }
      return new Promise(resolve => canvas.toBlob(resolve, "image/png"));
  }
  async function prepareMoveFrom(shape) {
    if (!selection?.assetId || !selection.pixelWidth || !selection.pixelHeight) throw new Error("Select an image");
    const mask = await maskBlob(shape.rectangle, shape.polygon);
    const cutout = await createCutout(selection.assetId, mask, selection.pixelWidth, selection.pixelHeight);
    const refined = { blob: cutout.mask };
    moveMaskRef.current = refined; setMoveMask(refined);
    setMovePreview({ target: selectedId, image: cutout.image }); onMoveReady?.();
  }
  useImperativeHandle(ref, () => ({ zoom, fit, fitExpansion,
    clearMask: () => { setStrokes([]); setCrop(null); setMovePreview(null); setMoveSelection(null); setMoveMask(null); moveMaskRef.current = null; },
    clearMovePreview: () => { setMovePreview(null); setMoveSelection(null); setMoveMask(null); moveMaskRef.current = null; },
    maskBlob,
    async prepareMove() {
      if (!selection?.assetId || !selection.pixelWidth || !selection.pixelHeight) throw new Error("Select an image");
      const mask = await maskBlob();
      const cutout = await createCutout(selection.assetId, mask, selection.pixelWidth, selection.pixelHeight);
      const refined = { blob: cutout.mask };
      setMoveMask(refined); moveMaskRef.current = refined; setMovePreview({ target: selectedId, image: cutout.image });
      return true;
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
    if (!["mask", "crop", "move-select-rect", "move-select-lasso"].includes(mode)) { if (e.target === e.target.getStage()) onSelect(null); return; }
    const p = point(); if (!p) return;
    drawing.current = true;
    if (mode === "crop") { cropStart.current = p; setCrop(null); }
    else if (mode === "move-select-rect") { cropStart.current = p; activeMove.current = { rectangle: { left: p.x, top: p.y, width: 1, height: 1 } }; setMoveSelection(activeMove.current); }
    else if (mode === "move-select-lasso") { activeMove.current = { polygon: [p.x, p.y, p.x + 0.1, p.y + 0.1] }; setMoveSelection(activeMove.current); }
    else { const stroke = { target: maskKey, width: brushSize, points: [p.x, p.y, p.x + 0.1, p.y + 0.1] }; activeStroke.current = stroke; setStrokes(current => [...current, stroke]); }
  }
  function move() {
    if (!drawing.current) return;
    const p = point(); if (!p) return;
    if (mode === "crop" || mode === "move-select-rect") {
      const start = cropStart.current;
      if (!start) return;
      const rect = { left: Math.round(Math.min(p.x, start.x)), top: Math.round(Math.min(p.y, start.y)), width: Math.max(1, Math.floor(Math.abs(p.x - start.x))), height: Math.max(1, Math.floor(Math.abs(p.y - start.y))) };
      if (mode === "crop") { setCrop(rect); onCrop(rect); }
      else { activeMove.current = { rectangle: rect }; setMoveSelection(activeMove.current); }
    } else if (mode === "move-select-lasso" && activeMove.current) {
      activeMove.current = { polygon: [...activeMove.current.polygon, p.x, p.y] }; setMoveSelection(activeMove.current);
    } else if (activeStroke.current) {
      activeStroke.current = { ...activeStroke.current, points: [...activeStroke.current.points, p.x, p.y] };
      setStrokes(current => [...current.slice(0, -1), activeStroke.current]);
    }
  }
  async function finishDrawing() {
    drawing.current = false;
    if (!["move-select-rect", "move-select-lasso"].includes(mode) || !activeMove.current) return;
    const shape = activeMove.current; activeMove.current = null;
    cropStart.current = null;
    const valid = shape.rectangle ? shape.rectangle.width >= 3 && shape.rectangle.height >= 3 : shape.polygon?.length >= 8;
    if (!valid) return;
    onMovePreparing?.();
    try { await prepareMoveFrom(shape); } catch (error) { onMoveFailed?.(); onError(error); }
  }
  const editing = selection?.type === "image" && ["mask", "crop", "move", "move-preparing", "move-select-rect", "move-select-lasso", "expand"].includes(mode);
  return <div ref={container} className={`ms-stage ${mode === "hand" ? "is-hand" : mode === "move" ? "is-move-object" : mode === "move-preparing" ? "is-processing" : editing ? "is-brush" : ""}`} data-mode={mode} data-camera-scale={camera.scale} aria-label={label} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); onUpload(e.dataTransfer.files); }}>
    <Stage ref={stage} {...dimensions} x={camera.x} y={camera.y} scaleX={camera.scale} scaleY={camera.scale} draggable={mode === "hand"} onDragEnd={e => { if (e.target === stage.current) updateCamera({ x: e.target.x(), y: e.target.y() }); }}
      onWheel={e => { e.evt.preventDefault(); const pointer = stage.current.getPointerPosition(); const next = Math.max(0.08, Math.min(4, camera.scale * (e.evt.deltaY > 0 ? 0.93 : 1.07))); setCamera({ scale: next, x: pointer.x - (pointer.x - camera.x) / camera.scale * next, y: pointer.y - (pointer.y - camera.y) / camera.scale * next }); }}
      onMouseDown={down} onTouchStart={down} onMouseMove={move} onTouchMove={move} onMouseUp={finishDrawing} onTouchEnd={finishDrawing} onMouseLeave={finishDrawing}>
      <Layer ref={artwork}>
        {layers.filter(l => l.visible).map(item => <Picture key={item.id} item={item} selected={selectedId === item.id} interactive={mode === "select"} accent={color} onError={onError} onSelect={() => { if (!editing) onSelect(item.id); }} onChange={patch => { try { onChange(layers.map(l => l.id === item.id ? { ...l, ...patch } : l)); } catch (e) { onError(e); } }} />)}
      </Layer>
      {editing && !["crop", "expand", "move"].includes(mode) && <Layer listening={false}><Group x={selection.x} y={selection.y} rotation={selection.rotation} scaleX={selection.width / selection.pixelWidth} scaleY={selection.height / selection.pixelHeight} clipWidth={selection.pixelWidth} clipHeight={selection.pixelHeight}>
        {mode === "mask" && strokes.filter(s => s.target === maskKey).map((s, i) => <Line key={i} points={s.points} stroke={color} strokeWidth={s.width} opacity={0.55} lineCap="round" lineJoin="round" />)}
        {mode === "move-select-rect" && moveSelection?.rectangle && <Rect x={moveSelection.rectangle.left} y={moveSelection.rectangle.top} width={moveSelection.rectangle.width} height={moveSelection.rectangle.height} stroke={color} strokeWidth={2 / camera.scale} dash={[8, 5]} fill={`${color}20`} />}
        {mode === "move-select-lasso" && moveSelection?.polygon && <Line points={moveSelection.polygon} stroke={color} strokeWidth={2 / camera.scale} fill={`${color}20`} closed lineCap="round" lineJoin="round" />}
      </Group></Layer>}
      {mode === "crop" && selection && <Layer><Group x={selection.x} y={selection.y} rotation={selection.rotation} scaleX={selection.width / selection.pixelWidth} scaleY={selection.height / selection.pixelHeight} clipWidth={selection.pixelWidth} clipHeight={selection.pixelHeight}>
        <CropBox value={crop || { left: 0, top: 0, width: selection.pixelWidth, height: selection.pixelHeight }} width={selection.pixelWidth} height={selection.pixelHeight} accent={color} onChange={rect => { setCrop(rect); onCrop(rect); }} />
      </Group></Layer>}
      {mode === "expand" && selection && <Layer><Group x={selection.x} y={selection.y} rotation={selection.rotation} scaleX={selection.width / selection.pixelWidth} scaleY={selection.height / selection.pixelHeight}>
        <ExpansionBox value={expandPadding} width={selection.pixelWidth} height={selection.pixelHeight} accent={color} onChange={onExpandPadding} />
      </Group></Layer>}
      {mode === "move" && movePreview?.target === selectedId && selection && <Layer><Group x={selection.x} y={selection.y} rotation={selection.rotation} scaleX={selection.width / selection.pixelWidth} scaleY={selection.height / selection.pixelHeight} clipWidth={selection.pixelWidth} clipHeight={selection.pixelHeight}>
        <CanvasImage image={movePreview.image} width={selection.pixelWidth} height={selection.pixelHeight} x={moveOffset.dx} y={moveOffset.dy} draggable opacity={0.9} shadowColor="#000" shadowBlur={8} shadowOpacity={0.25}
          onDragMove={event => { const dx = Math.round(Math.max(-selection.pixelWidth + 1, Math.min(selection.pixelWidth - 1, event.target.x()))), dy = Math.round(Math.max(-selection.pixelHeight + 1, Math.min(selection.pixelHeight - 1, event.target.y()))); event.target.position({ x: dx, y: dy }); onMoveOffset?.({ dx, dy }); }} />
      </Group></Layer>}
    </Stage>
  </div>;
});
export default StudioCanvas;
