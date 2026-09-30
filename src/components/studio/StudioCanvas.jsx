"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Stage, Layer, Image as CanvasImage, Transformer, Text, Group, Line, Rect } from "react-konva";
import CropOverlay from "./canvas/CropOverlay";
import { exportCanvas } from "@/lib/studio/canvas-export";
import MoveRegions from "./canvas/MoveRegions";
import { editRegion } from "@/lib/studio/selection-geometry";
import { useCanvasState } from "./canvas/hooks/useCanvasState";
import { useDrawingState } from "./canvas/hooks/useDrawingState";
import { useSelectionState } from "./canvas/hooks/useSelectionState";
import { loadImage } from "@/lib/studio/image-processor";
import { imageUrl, previewUrl } from "@/lib/studio/image-url";
import { getCursorForMode } from "@/lib/studio/cursor-generator";

async function createCutout(assetId, maskBlob, signal, tool, point, onLoading) {
  const form = new FormData();
  form.append("assetId", assetId);
  form.append("selection", maskBlob, "selection.png");
  if (tool) form.append("tool", tool);
  if (point) form.append("point", JSON.stringify(point));
  const timeout = AbortSignal.timeout(65000);
  const response = await fetch("/api/studio/segment", { method: "POST", body: form, signal: AbortSignal.any([signal, timeout]), headers: { Accept: "application/json" } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.code || "SEGMENTATION_FAILED");
  }
  const result = await response.json();
  onLoading?.("preview");
  const image = await loadImage(previewUrl(result.object), { signal });
  return { image, bounds: result.bounds, maskId: result.mask, objectAssetId: result.object, holeAssetId: result.hole };
}

function Picture({ item, shouldLoad = true, selected, onSelect, onChange, interactive, accent, onError, previewImage, onPreview }) {
  const [image, setImage] = useState(null);
  const shape = useRef(null), transformer = useRef(null);
  useEffect(() => {
    if (item.type !== "image") return;
    let live = true;
    if (!shouldLoad) { Promise.resolve().then(() => { if (live) setImage(null); }); return () => { live = false; }; }
    loadImage(previewUrl(item.assetId))
      .then(processed => { if (live) setImage(processed); })
      .catch(error => { if (live) onError(error); });
    return () => { live = false; };
  }, [item.assetId, item.type, onError, shouldLoad]);
  useEffect(() => { if (selected && transformer.current && shape.current) { transformer.current.nodes([shape.current]); transformer.current.getLayer().batchDraw(); } }, [selected, interactive]);
  const props = { ref: shape, id: item.id, x: item.x, y: item.y, width: item.width, height: item.height, rotation: item.rotation || 0, opacity: item.opacity ?? 1, draggable: interactive,
    onClick: onSelect, onTap: onSelect, onDblClick: onPreview, onDblTap: onPreview, onDragEnd: e => onChange({ x: e.target.x(), y: e.target.y() }),
    onTransformEnd: () => { const node = shape.current; const width = Math.max(16, node.width() * node.scaleX()), height = Math.max(16, node.height() * node.scaleY()); node.scaleX(1); node.scaleY(1); onChange({ x: node.x(), y: node.y(), width, height, rotation: node.rotation() }); } };
  return <>
    {item.type === "image" ? <CanvasImage {...props} image={previewImage || image} /> : item.type === "text" ? <Text {...props} text={item.text || ""} fontSize={item.fontSize || 36} fill={item.fill || accent} fontFamily="Arial, sans-serif" /> : <Group {...props}><Rect width={item.width} height={item.height} fill={accent} opacity={0.13} cornerRadius={12} /><Text text="▶  VIDEO" width={item.width} align="center" y={item.height / 2 - 10} fill={accent} fontSize={22} /></Group>}
    {selected && interactive && <Transformer ref={transformer} flipEnabled={false} borderStroke={accent} anchorStroke={accent} anchorFill="#fff" anchorSize={9} anchorCornerRadius={4} padding={3} boundBoxFunc={(old, next) => next.width < 16 || next.height < 16 || next.width > 8192 || next.height > 8192 ? old : next} />}
  </>;
}

function CropBox({ value, width, height, scale = 1, onChange }) {
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
  const handle = 14 / Math.max(scale, 0.01), lineWidth = 3.5 / Math.max(scale, 0.01);
  const left = value.left, top = value.top, right = left + value.width, bottom = top + value.height;
  const corners = [
    [left, top + handle, left, top, left + handle, top],
    [right - handle, top, right, top, right, top + handle],
    [left, bottom - handle, left, bottom, left + handle, bottom],
    [right - handle, bottom, right, bottom, right, bottom - handle],
  ];
  return <><Rect ref={shape} x={value.left} y={value.top} width={value.width} height={value.height} stroke="#ffffff" strokeWidth={2 / Math.max(scale, 0.01)} fill="#ffffff08" draggable
    onDragMove={event => commit(event.target)} onTransformEnd={event => commit(event.target)} />
    <Transformer ref={transformer} rotateEnabled={false} flipEnabled={false} anchorFill="#fff" anchorStroke="#111318" anchorStrokeWidth={1.5} borderStroke="#fff" borderStrokeWidth={2} anchorSize={12}
      enabledAnchors={["top-left", "top-center", "top-right", "middle-left", "middle-right", "bottom-left", "bottom-center", "bottom-right"]} />
    {corners.map((points, index) => <Line key={index} points={points} stroke="#fff" strokeWidth={lineWidth} lineCap="round" lineJoin="round" shadowColor="#08090d" shadowBlur={5 / Math.max(scale, 0.01)} listening={false} />)}</>;
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

const StudioCanvas = forwardRef(function StudioCanvas({ layers, selectedId, onSelect, onChange, mode, onMaskChange, panning: requestedPanning = false, moveRegions, onMoveRegions, onPreview, onViewport, onCamera, zh, selectionTool, editPadding = 0.25, brushSize = 35, moveOffset = { dx: 0, dy: 0 }, onMoveOffset, onMovePreparing, onMoveReady, onMoveFailed, onCrop, cropRect, cropShape, cropGrid, onCropGrid, expandPadding = 256, onExpandPadding, onZoom, onUpload, onError, label }, ref) {
  const [middleHeld, setMiddleHeld] = useState(false);
  const panning = requestedPanning || middleHeld;
  const container = useRef(null), stage = useRef(null), artwork = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const selectionInk = "#30ed19";

  // Use custom hooks for state management
  const { camera, updateCamera, zoom, fit, fitExpansion } = useCanvasState(dimensions, layers);
  const { strokes, isDrawing, startStroke, addPoint, endStroke, clearAll: clearStrokes } = useDrawingState();
  const {
    crop, movePreview, moveSelection, moveMask, activeMove,
    startCrop, updateCrop,
    startMoveRect, updateMoveRect, startMoveLasso, addLassoPoint,
    setMovePreviewData: setMovePreview, setMoveMaskData, clearMove, clearAll: clearSelection
  } = useSelectionState();
  // Selection chrome must contrast with every image and must not recolor
  // the application (or download an original) whenever geometry changes.
  const color = "#ff9a36";

  const drawing = useRef(false), cropStart = useRef(null);
  const [drawingActive, setDrawingActive] = useState(false);
  const expansionTarget = useRef(null);
  const selection = layers.find(l => l.id === selectedId);
  const selectionRequest = useRef(null), operation = useRef(0);
  useEffect(() => () => { operation.current++; selectionRequest.current?.abort(); }, [selectedId]);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setDimensions({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => { onZoom(camera.scale); }, [camera.scale, onZoom]);
  useEffect(() => { onCamera?.(camera); }, [camera, onCamera]);
  useEffect(() => { if (selection) onViewport?.({ left: camera.x + selection.x * camera.scale, top: camera.y + selection.y * camera.scale, width: selection.width * camera.scale, height: selection.height * camera.scale, viewportWidth: dimensions.width, viewportHeight: dimensions.height }); }, [camera, selection, dimensions, onViewport]);
  const maskKey = `${selectedId}:mask`;
  const hasMask = strokes.some(stroke => stroke.target === maskKey);
  useEffect(() => { onMaskChange?.(hasMask); }, [hasMask, onMaskChange]);
  const toolKey = `${selectedId}:${mode}`;
  useEffect(() => { drawing.current = false; clearStrokes(); }, [toolKey, clearStrokes]);
  useEffect(() => {
    if (mode !== "expand" || !selection?.pixelWidth || !selection?.pixelHeight) { expansionTarget.current = null; return; }
    if (expansionTarget.current === selectedId) return;
    expansionTarget.current = selectedId;
    fitExpansion(selection, expandPadding);
  }, [mode, selectedId, selection, expandPadding, fitExpansion]);

  async function maskBlob(rectangle, polygon) {
      if (!selection) throw new Error("Select an image");
      const canvas = document.createElement("canvas");
      canvas.width = selection.pixelWidth; canvas.height = selection.pixelHeight;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "black"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = "white"; ctx.fillStyle = "white"; ctx.lineCap = "round"; ctx.lineJoin = "round";
      const direct = rectangle || polygon ? { rectangle, polygon } : moveMask;
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
          // Freehand loops select the enclosed area, not only a thin edge.
          if (stroke.points.length >= 6) { ctx.closePath(); ctx.fill(); }
          ctx.stroke(); ctx.beginPath(); ctx.arc(stroke.points[0], stroke.points[1], stroke.width / 2, 0, Math.PI * 2); ctx.fill();
        }
      }
      return new Promise(resolve => canvas.toBlob(resolve, "image/png"));
  }
  async function prepareMoveFrom(shape) {
    if (!selection?.assetId || !selection.pixelWidth || !selection.pixelHeight) throw new Error("Select an image");
    const current = ++operation.current;
    selectionRequest.current?.abort();
    const controller = new AbortController(); selectionRequest.current = controller;
    const mask = await maskBlob(shape.rectangle, shape.polygon);
    if (current !== operation.current) return;
    let cutout;
    try { cutout = await createCutout(selection.assetId, mask, controller.signal, selectionTool, shape.point, onMovePreparing); }
    catch (error) { if (current !== operation.current) return; throw error; }
    if (current !== operation.current) return;
    setMoveMaskData({ maskId: cutout.maskId });
    const { bounds } = cutout;
    const object = document.createElement("canvas"); object.width = bounds.width; object.height = bounds.height;
    object.getContext("2d").drawImage(cutout.image, 0, 0, bounds.width, bounds.height);
    const thumb = document.createElement("canvas");
    const ratio = Math.min(1, 160 / Math.max(bounds.width, bounds.height));
    thumb.width = Math.max(1, Math.round(bounds.width * ratio)); thumb.height = Math.max(1, Math.round(bounds.height * ratio));
    thumb.getContext("2d").drawImage(object, 0, 0, thumb.width, thumb.height);
    setMovePreview({ target: selectedId, image: object, bounds });
    onMoveReady?.({ bounds, thumbnail: thumb.toDataURL("image/png"), maskId: cutout.maskId, objectAssetId: cutout.objectAssetId, holeAssetId: cutout.holeAssetId });
  }

  useImperativeHandle(ref, () => ({ zoom, fit, fitExpansion, restoreView: updateCamera,
    focusLayer(id) {
      const item = layers.find(layer => layer.id === id);
      if (!item) return;
      const scale = Math.max(.08, Math.min(1.5, (dimensions.width - 120) / item.width, (dimensions.height - 180) / item.height));
      updateCamera({ scale, x: dimensions.width / 2 - (item.x + item.width / 2) * scale, y: dimensions.height / 2 - (item.y + item.height / 2) * scale });
    },
    focusSelection() {
      if (!selection) return;
      const scale = Math.max(0.08, Math.min(2, (dimensions.width - 120) / selection.width, (dimensions.height - 350) / selection.height));
      updateCamera({ scale, x: (dimensions.width - selection.width * scale) / 2 - selection.x * scale, y: 45 + (dimensions.height - 350 - selection.height * scale) / 2 - selection.y * scale });
    },
    clearMask: () => { operation.current++; selectionRequest.current?.abort(); clearStrokes(); clearSelection(); },
    clearMovePreview: () => { operation.current++; selectionRequest.current?.abort(); clearMove(); },
    maskBlob,
    exportImage: options => exportCanvas(artwork.current, layers, { ...options, selectedId }),
    exportPNG: () => exportCanvas(artwork.current, layers),
  }));
  function point() {
    if (!selection || !stage.current) return null;
    const node = stage.current.findOne(`#${selectedId}`);
    if (!node) return null;
    const p = node.getAbsoluteTransform().copy().invert().point(stage.current.getPointerPosition());
    const x = p.x / selection.width * selection.pixelWidth, y = p.y / selection.height * selection.pixelHeight;
    return { x: Math.max(0, Math.min(selection.pixelWidth, x)), y: Math.max(0, Math.min(selection.pixelHeight, y)) };
  }

  useEffect(() => {
    const release = () => {
      if (!middleHeld) return;
      stage.current?.stopDrag();
      if (stage.current) updateCamera({ x: stage.current.x(), y: stage.current.y() });
      setMiddleHeld(false);
    };
    window.addEventListener("mouseup", release); window.addEventListener("blur", release);
    return () => { window.removeEventListener("mouseup", release); window.removeEventListener("blur", release); };
  }, [middleHeld, updateCamera]);

  function handleMouseDown(e) {
    if (panning) return;
    if (e.evt?.button && e.evt.button !== 0) return;
    if (mode.startsWith("object-select-")) {
      const imageNode = artwork.current?.findOne(`#${selectedId}`);
      if (e.target !== imageNode) return;
    }
    if (!["mask", "crop", "object-select-rect", "object-select-lasso"].includes(mode)) {
      if (mode === "select" && e.target === e.target.getStage()) onSelect(null);
      return;
    }
    const p = point(); if (!p) return;
    drawing.current = true;
    setDrawingActive(true);
    if (mode === "crop") {
      cropStart.current = p;
      startCrop(p); onCrop(null);
    }
    else if (mode === "object-select-rect") {
      cropStart.current = p;
      startMoveRect(p);
    }
    else if (mode === "object-select-lasso") {
      startMoveLasso(p);
    }
    else {
      startStroke(p, maskKey, brushSize / (camera.scale * selection.width / selection.pixelWidth));
    }
  }

  function handleMouseMove() {
    if (panning || !drawing.current) return;
    const p = point(); if (!p) return;
    if (mode === "crop" || mode === "object-select-rect") {
      const start = cropStart.current;
      if (!start) return;
      const rect = {
        left: Math.round(Math.min(p.x, start.x)),
        top: Math.round(Math.min(p.y, start.y)),
        width: Math.max(1, Math.floor(Math.abs(p.x - start.x))),
        height: Math.max(1, Math.floor(Math.abs(p.y - start.y)))
      };
      if (mode === "crop") {
        updateCrop(rect); onCrop(rect);
      }
      else {
        updateMoveRect(rect);
      }
    } else if (mode === "object-select-lasso") {
      addLassoPoint(p);
    } else {
      addPoint(p);
    }
  }

  async function finishDrawing() {
    if (panning || !drawing.current) return;
    drawing.current = false;
    setDrawingActive(false);
    endStroke();
    if (!["object-select-rect", "object-select-lasso"].includes(mode) || !activeMove.current) return;
    const shape = { ...activeMove.current };
    cropStart.current = null;
    if (selectionTool === "move") {
      if (shape.rectangle?.width >= 3 && shape.rectangle?.height >= 3) onMoveReady?.({ bounds: shape.rectangle, region: true });
      return;
    }
    if (shape.rectangle && shape.rectangle.width < 3 && shape.rectangle.height < 3) {
      shape.point = {
        x: Math.min(selection.pixelWidth - 1, Math.round(shape.rectangle.left)),
        y: Math.min(selection.pixelHeight - 1, Math.round(shape.rectangle.top))
      };
    }
    const valid = shape.point || (shape.rectangle ? shape.rectangle.width >= 3 && shape.rectangle.height >= 3 : shape.polygon?.length >= 8);
    if (!valid) return;
    onMovePreparing?.();
    try { await prepareMoveFrom(shape); }
    catch (error) {
      if (error.name !== "AbortError") {
        onMoveFailed?.();
        onError(error.name === "TimeoutError" ? new Error("SEGMENTATION_TIMEOUT") : error);
      }
    }
  }
  // A stroke belongs to the pointer, not to the canvas rectangle. The editor
  // card can sit over the lower edge of the artwork, so finish only when the
  // pointer is released (including when release happens over that card).
  useEffect(() => {
    const release = () => { if (drawing.current) finishDrawing(); };
    document.addEventListener("mouseup", release);
    document.addEventListener("pointerup", release);
    document.addEventListener("touchend", release);
    return () => {
      document.removeEventListener("mouseup", release);
      document.removeEventListener("pointerup", release);
      document.removeEventListener("touchend", release);
    };
  });
  const editing = selection?.type === "image" && ["mask", "crop", "move", "object-edit", "object-preparing", "object-select-rect", "object-select-lasso", "expand"].includes(mode);
  const cursorStyle = getCursorForMode(panning ? "hand" : mode, brushSize, selectionInk);

  return <div ref={container} className={`ms-stage ${drawingActive ? "is-drawing" : ""}`} data-selection-frame={selection ? JSON.stringify({ left: camera.x + selection.x * camera.scale, top: camera.y + selection.y * camera.scale, width: selection.width * camera.scale, height: selection.height * camera.scale }) : undefined} data-mode={mode} data-panning={panning} data-camera-scale={camera.scale} data-camera={JSON.stringify(camera)} data-crop={JSON.stringify({ rect: cropRect, shape: cropShape, grid: cropGrid })} aria-label={label} style={{ cursor: cursorStyle }}
    onMouseDownCapture={e => {
      if (e.button !== 1) return;
      e.preventDefault(); e.stopPropagation();
      stage.current.setPointersPositions(e.nativeEvent); stage.current.draggable(true); stage.current.startDrag(); setMiddleHeld(true);
    }}
    onDragOver={e => e.preventDefault()}
    onDrop={e => { e.preventDefault(); onUpload(e.dataTransfer.files); }}>
    <Stage onDblClick={e => { if (e.target === stage.current) fit(); }} onDblTap={e => { if (e.target === stage.current) fit(); }} ref={stage} {...dimensions} x={camera.x} y={camera.y} scaleX={camera.scale} scaleY={camera.scale} draggable={panning}
      onDragEnd={e => { if (e.target === stage.current) updateCamera({ x: e.target.x(), y: e.target.y() }); }}
      onWheel={e => {
        e.evt.preventDefault();
        const pointer = stage.current.getPointerPosition();
        const next = Math.max(0.08, Math.min(4, camera.scale * (e.evt.deltaY > 0 ? 0.93 : 1.07)));
        updateCamera({
          scale: next,
          x: pointer.x - (pointer.x - camera.x) / camera.scale * next,
          y: pointer.y - (pointer.y - camera.y) / camera.scale * next
        });
      }}
      onMouseDown={handleMouseDown} onTouchStart={handleMouseDown}
      onMouseMove={handleMouseMove} onTouchMove={handleMouseMove}
      onMouseUp={finishDrawing} onTouchEnd={finishDrawing}>
      <Layer ref={artwork}>
        {layers.filter(l => l.visible).map(item => <Picture key={item.id} item={item} shouldLoad={camera.x + item.x * camera.scale + Math.max(item.width, item.height) * camera.scale > -200 && camera.y + item.y * camera.scale + Math.max(item.width, item.height) * camera.scale > -200 && camera.x + item.x * camera.scale - Math.max(item.width, item.height) * camera.scale < dimensions.width + 200 && camera.y + item.y * camera.scale - Math.max(item.width, item.height) * camera.scale < dimensions.height + 200} selected={selectedId === item.id} interactive={!panning && mode === "select"} accent={color} onError={onError} onPreview={() => { if (!editing && item.type === "image") onPreview?.(item.assetId); }} onSelect={() => { if (!panning && !editing) onSelect(item.id); }} onChange={patch => { try { onChange(layers.map(l => l.id === item.id ? { ...l, ...patch } : l)); } catch (e) { onError(e); } }} />)}
      </Layer>
      {editing && !["crop", "expand", "move", "object-edit"].includes(mode) && <Layer listening={false}><Group x={selection.x} y={selection.y} rotation={selection.rotation} scaleX={selection.width / selection.pixelWidth} scaleY={selection.height / selection.pixelHeight} clipWidth={selection.pixelWidth} clipHeight={selection.pixelHeight}>
        {mode === "mask" && strokes.filter(s => s.target === maskKey).map((s, i, lines) => <Line key={i} points={s.points} stroke={selectionInk} strokeWidth={s.width} closed={!isDrawing || i < lines.length - 1} lineCap="round" lineJoin="round" />)}
        {mode === "object-select-rect" && moveSelection?.rectangle && <>
          <Rect x={moveSelection.rectangle.left} y={moveSelection.rectangle.top} width={moveSelection.rectangle.width} height={moveSelection.rectangle.height} fill={`${color}35`} />
          <Rect x={moveSelection.rectangle.left} y={moveSelection.rectangle.top} width={moveSelection.rectangle.width} height={moveSelection.rectangle.height} stroke={color} strokeWidth={3 / (camera.scale * selection.width / selection.pixelWidth)} dash={[10, 8]} />
          <Rect x={moveSelection.rectangle.left} y={moveSelection.rectangle.top} width={moveSelection.rectangle.width} height={moveSelection.rectangle.height} stroke="#ffffff" strokeWidth={1.5 / (camera.scale * selection.width / selection.pixelWidth)} opacity={0.6} />
        </>}
        {mode === "object-select-lasso" && moveSelection?.polygon && <>
          <Line points={moveSelection.polygon} fill={`${color}35`} closed />
          <Line points={moveSelection.polygon} stroke={color} strokeWidth={3 / (camera.scale * selection.width / selection.pixelWidth)} closed lineCap="round" lineJoin="round" />
          <Line points={moveSelection.polygon} stroke="#ffffff" strokeWidth={1.5 / (camera.scale * selection.width / selection.pixelWidth)} opacity={0.6} closed lineCap="round" lineJoin="round" />
        </>}
      </Group></Layer>}
      {mode === "crop" && selection && <Layer listening={!panning}><Group x={selection.x} y={selection.y} rotation={selection.rotation} scaleX={selection.width / selection.pixelWidth} scaleY={selection.height / selection.pixelHeight} clipWidth={selection.pixelWidth} clipHeight={selection.pixelHeight}>
        {cropShape !== "grid" && <CropOverlay rect={cropRect || crop || { left: 0, top: 0, width: selection.pixelWidth, height: selection.pixelHeight }} shape={cropShape} grid={cropGrid || { x: [.5], y: [.5] }} onGrid={onCropGrid} scale={camera.scale * selection.width / selection.pixelWidth} accent="#ffffff" canvasWidth={selection.pixelWidth} canvasHeight={selection.pixelHeight} />}
        <CropBox value={cropRect || crop || { left: 0, top: 0, width: selection.pixelWidth, height: selection.pixelHeight }} width={selection.pixelWidth} height={selection.pixelHeight} scale={camera.scale * selection.width / selection.pixelWidth} onChange={rect => { updateCrop(rect); onCrop(rect); }} />
        {cropShape === "grid" && <CropOverlay rect={cropRect || crop || { left: 0, top: 0, width: selection.pixelWidth, height: selection.pixelHeight }} shape={cropShape} grid={cropGrid || { x: [.5], y: [.5] }} onGrid={onCropGrid} scale={camera.scale * selection.width / selection.pixelWidth} accent="#ff8a00" canvasWidth={selection.pixelWidth} canvasHeight={selection.pixelHeight} />}
      </Group></Layer>}
      {mode === "expand" && selection && <Layer listening={!panning}><Group x={selection.x} y={selection.y} rotation={selection.rotation} scaleX={selection.width / selection.pixelWidth} scaleY={selection.height / selection.pixelHeight}>
        <ExpansionBox value={expandPadding} width={selection.pixelWidth} height={selection.pixelHeight} accent={color} onChange={onExpandPadding} />
      </Group></Layer>}
      {mode === "move" && moveRegions && selection && <Layer listening={!panning}><Group x={selection.x} y={selection.y} rotation={selection.rotation} scaleX={selection.width / selection.pixelWidth} scaleY={selection.height / selection.pixelHeight} clipWidth={selection.pixelWidth} clipHeight={selection.pixelHeight}>
        <MoveRegions {...moveRegions} width={selection.pixelWidth} height={selection.pixelHeight} scale={camera.scale * selection.width / selection.pixelWidth} onChange={onMoveRegions} zh={zh} />
      </Group></Layer>}
      {["move", "object-edit"].includes(mode) && movePreview?.target === selectedId && selection && <Layer listening={!panning}><Group x={selection.x} y={selection.y} rotation={selection.rotation} scaleX={selection.width / selection.pixelWidth} scaleY={selection.height / selection.pixelHeight} clipWidth={selection.pixelWidth} clipHeight={selection.pixelHeight}>
        {mode === "object-edit" && (() => {
          const region = editRegion(movePreview.bounds, selection.pixelWidth, selection.pixelHeight, editPadding);
          return <Rect x={region.left} y={region.top} width={region.width} height={region.height} stroke="#fff" strokeWidth={1 / (camera.scale * selection.width / selection.pixelWidth)} dash={[5, 5]} fill="#FFFFFF08" listening={false} />;
        })()}
        <CanvasImage image={movePreview.image} width={movePreview.bounds.width} height={movePreview.bounds.height}
          x={movePreview.bounds.left + (mode === "move" ? moveOffset.dx : 0)} y={movePreview.bounds.top + (mode === "move" ? moveOffset.dy : 0)} draggable={mode === "move"}
          opacity={mode === "move" && (moveOffset.dx || moveOffset.dy) ? 0.85 : 1}
          onDragMove={event => {
            const bounds = movePreview.bounds;
            const dx = Math.round(Math.max(-bounds.left, Math.min(selection.pixelWidth - bounds.left - bounds.width, event.target.x() - bounds.left)));
            const dy = Math.round(Math.max(-bounds.top, Math.min(selection.pixelHeight - bounds.top - bounds.height, event.target.y() - bounds.top)));
            event.target.position({ x: bounds.left + dx, y: bounds.top + dy }); onMoveOffset?.({ dx, dy });
          }} />
        <Rect x={movePreview.bounds.left + (mode === "move" ? moveOffset.dx : 0) - 3} y={movePreview.bounds.top + (mode === "move" ? moveOffset.dy : 0) - 3}
          width={movePreview.bounds.width + 6} height={movePreview.bounds.height + 6} stroke={color} strokeWidth={1.5 / (camera.scale * selection.width / selection.pixelWidth)} dash={[7, 5]} cornerRadius={3} listening={false} />
      </Group></Layer>}
    </Stage>
  </div>;
});
export default StudioCanvas;
