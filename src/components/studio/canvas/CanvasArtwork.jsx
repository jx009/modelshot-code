"use client";
import { forwardRef, memo, useEffect, useMemo, useRef, useState } from "react";
import { Layer, Image as CanvasImage, Transformer, Text, Group, Rect } from "react-konva";
import { loadImage } from "@/lib/studio/image-processor";
import { imageUrl, previewUrl } from "@/lib/studio/image-url";
import { adjustedImage } from "@/lib/studio/adjustments";
import { TEXT_LINE_HEIGHT } from "@/lib/studio/text-layer";

const Picture = memo(function Picture({ item, editingText, textColor, shouldLoad = true, highResolution, previewSize = 1280, adjustmentPreview, selected, multiSelected = false, onSelect, onChange, interactive, accent, onError, previewImage, onPreview }) {
  const [preview, setPreview] = useState(null), [original, setOriginal] = useState(null);
  // Text has no assetId: comparing two undefined IDs used to enter the image
  // branch and dereference null, taking the entire Konva root down with it.
  const image = item.type !== "image" || !shouldLoad ? null : highResolution && original?.assetId === item.assetId ? original?.image : preview?.assetId === item.assetId ? preview?.image : null;
  const shape = useRef(null), transformer = useRef(null);
  useEffect(() => {
    if (item.type !== "image") return;
    let live = true;
    if (!shouldLoad) return;
    const abort = new AbortController();
    loadImage(previewUrl(item.assetId, previewSize), { signal: abort.signal })
      .then(image => { if (live) setPreview({ assetId: item.assetId, image }); })
      .catch(error => { if (live) onError(error); });
    return () => { live = false; abort.abort(); };
  }, [item.assetId, item.type, onError, shouldLoad, previewSize]);
  // Browsing uses bounded previews. Load the original only after the selected
  // image stays zoomed in long enough to need more than 1280 display pixels.
  useEffect(() => {
    if (item.type !== "image" || !shouldLoad || !highResolution || preview?.assetId !== item.assetId || original?.assetId === item.assetId) return;
    let live = true;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      loadImage(imageUrl(item.assetId), { signal: abort.signal })
        .then(image => { if (live) setOriginal({ assetId: item.assetId, image }); })
        .catch(() => { /* Keep the preview if optional full-resolution loading fails. */ });
    }, 700);
    return () => { live = false; clearTimeout(timer); abort.abort(); };
  }, [item.assetId, item.type, shouldLoad, highResolution, preview?.assetId, original?.assetId]);
  const rendered = useMemo(() => image ? adjustedImage(image, adjustmentPreview ?? item.adjustments, 1600) : null, [image, adjustmentPreview, item.adjustments]);
  useEffect(() => { if (selected && transformer.current && shape.current) { transformer.current.nodes([shape.current]); transformer.current.getLayer().batchDraw(); } }, [selected, interactive, editingText]);
  const props = { ref: shape, id: item.id, x: item.x, y: item.y, width: item.width, height: item.height, rotation: item.rotation || 0, opacity: item.opacity ?? 1, draggable: interactive,
    onClick: event => event?.evt?.shiftKey ? onSelect(item.id, true) : onSelect(item.id), onTap: () => onSelect(item.id), onDblClick: () => onPreview(item, image), onDblTap: () => onPreview(item, image), onDragEnd: e => { if (!multiSelected) onChange(item.id, { x: e.target.x(), y: e.target.y() }); },
    onTransformEnd: () => { if (multiSelected) return; const node = shape.current; const width = Math.max(16, node.width() * node.scaleX()), height = Math.max(16, node.height() * node.scaleY()); node.scaleX(1); node.scaleY(1); onChange(item.id, { x: node.x(), y: node.y(), width, height, rotation: node.rotation() }); } };
  return <>
    {item.type === "image" ? <CanvasImage {...props} image={previewImage || rendered} /> : item.type === "text" ? <Text {...props} visible={!editingText} text={item.text || ""} wrap="char" lineHeight={TEXT_LINE_HEIGHT} fontSize={item.fontSize || 36} fill={item.fill || textColor} fontFamily="Arial, sans-serif" /> : <Group {...props}><Rect width={item.width} height={item.height} fill={accent} opacity={0.13} cornerRadius={12} /><Text text="▶  VIDEO" width={item.width} align="center" y={item.height / 2 - 10} fill={accent} fontSize={22} /></Group>}
    {selected && interactive && !editingText && !multiSelected && <Transformer ref={transformer} flipEnabled={false} borderStroke={accent} anchorStroke={accent} anchorFill="#fff" anchorSize={9} anchorCornerRadius={4} padding={3} boundBoxFunc={(old, next) => next.width < 16 || next.height < 16 || next.width > 8192 || next.height > 8192 ? old : next} />}
  </>;
});

const CanvasArtwork = memo(forwardRef(function CanvasArtwork({ layers, editingTextId, textColor, camera, dimensions, selectedId, selectedIds = [], adjustmentPreview, interactive, accent, onError, onPreview, onSelect, onChange }, ref) {
  return <Layer ref={ref}>{layers.filter(item => item.visible).map(item => {
    const extent = Math.max(item.width, item.height) * camera.scale;
    const x = camera.x + item.x * camera.scale, y = camera.y + item.y * camera.scale;
    const shouldLoad = x + extent > -200 && y + extent > -200 && x - extent < dimensions.width + 200 && y - extent < dimensions.height + 200;
    const displayPixels = extent * Math.min(globalThis.devicePixelRatio || 1, 2);
    const highResolution = shouldLoad && selectedId === item.id && displayPixels > 1280 && Math.max(item.pixelWidth || 0, item.pixelHeight || 0) > 1280;
    const previewSize = displayPixels <= 320 ? 320 : displayPixels <= 640 ? 640 : 1280;
    return <Picture key={item.id} item={item} editingText={editingTextId === item.id} textColor={textColor} shouldLoad={shouldLoad} highResolution={highResolution} previewSize={previewSize} adjustmentPreview={selectedId === item.id ? adjustmentPreview : null} selected={selectedIds.includes(item.id) || selectedId === item.id} multiSelected={selectedIds.length > 1 && selectedIds.includes(item.id)} interactive={interactive && !item.locked} accent={accent} onError={onError} onPreview={onPreview} onSelect={onSelect} onChange={onChange} />;
  })}</Layer>;
}));
export default CanvasArtwork;
