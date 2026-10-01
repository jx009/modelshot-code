"use client";
import { forwardRef, memo, useEffect, useRef, useState } from "react";
import { Layer, Image as CanvasImage, Transformer, Text, Group, Rect } from "react-konva";
import { loadImage } from "@/lib/studio/image-processor";
import { previewUrl } from "@/lib/studio/image-url";

const Picture = memo(function Picture({ item, shouldLoad = true, selected, onSelect, onChange, interactive, accent, onError, previewImage, onPreview }) {
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
    onClick: () => onSelect(item.id), onTap: () => onSelect(item.id), onDblClick: () => onPreview(item), onDblTap: () => onPreview(item), onDragEnd: e => onChange(item.id, { x: e.target.x(), y: e.target.y() }),
    onTransformEnd: () => { const node = shape.current; const width = Math.max(16, node.width() * node.scaleX()), height = Math.max(16, node.height() * node.scaleY()); node.scaleX(1); node.scaleY(1); onChange(item.id, { x: node.x(), y: node.y(), width, height, rotation: node.rotation() }); } };
  return <>
    {item.type === "image" ? <CanvasImage {...props} image={previewImage || image} /> : item.type === "text" ? <Text {...props} text={item.text || ""} fontSize={item.fontSize || 36} fill={item.fill || accent} fontFamily="Arial, sans-serif" /> : <Group {...props}><Rect width={item.width} height={item.height} fill={accent} opacity={0.13} cornerRadius={12} /><Text text="▶  VIDEO" width={item.width} align="center" y={item.height / 2 - 10} fill={accent} fontSize={22} /></Group>}
    {selected && interactive && <Transformer ref={transformer} flipEnabled={false} borderStroke={accent} anchorStroke={accent} anchorFill="#fff" anchorSize={9} anchorCornerRadius={4} padding={3} boundBoxFunc={(old, next) => next.width < 16 || next.height < 16 || next.width > 8192 || next.height > 8192 ? old : next} />}
  </>;
});

const CanvasArtwork = memo(forwardRef(function CanvasArtwork({ layers, camera, dimensions, selectedId, interactive, accent, onError, onPreview, onSelect, onChange }, ref) {
  return <Layer ref={ref}>{layers.filter(item => item.visible).map(item => {
    const extent = Math.max(item.width, item.height) * camera.scale;
    const x = camera.x + item.x * camera.scale, y = camera.y + item.y * camera.scale;
    const shouldLoad = x + extent > -200 && y + extent > -200 && x - extent < dimensions.width + 200 && y - extent < dimensions.height + 200;
    return <Picture key={item.id} item={item} shouldLoad={shouldLoad} selected={selectedId === item.id} interactive={interactive} accent={accent} onError={onError} onPreview={onPreview} onSelect={onSelect} onChange={onChange} />;
  })}</Layer>;
}));
export default CanvasArtwork;
