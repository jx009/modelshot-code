"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Stage, Layer, Group, Rect, Ellipse, Line, Text, Image as CanvasImage, Transformer } from "react-konva";
import { loadImage } from "@/lib/studio/image-processor";
import { previewUrl } from "@/lib/studio/image-url";
import { useCanvasTextEdit } from "./useCanvasTextEdit";

import { layoutFonts as fonts, imageFrame, layoutTextProps, layoutShapeProps } from "@/lib/creation/layout-rendering";
const normalizedRotation = value => ((value + 180) % 360 + 360) % 360 - 180;
// Preserve the previous full object-frame hit region, including whitespace in
// text and transparent/rounded rectangles, without a second invisible Rect.
function frameHit(context, shape) {
  context.beginPath(); context.rect(0, 0, shape.width(), shape.height()); context.closePath(); context.fillStrokeShape(shape);
}
const ImageContent = memo(function ImageContent({ node }) {
  const [image, setImage] = useState(null), [failed, setFailed] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    loadImage(previewUrl(node.assetId, 1280), { signal: abort.signal }).then(value => { if (!abort.signal.aborted) setImage(value); }).catch(() => { if (!abort.signal.aborted) setFailed(true); });
    return () => abort.abort();
  }, [node.assetId]);
  return <Group clipWidth={node.width} clipHeight={node.height} listening={false}>
    <Rect width={node.width} height={node.height} fill="#e7e7e7" />
    {image && <CanvasImage image={image} {...imageFrame(image, node)} />}
    {failed && <Text text="图片加载失败 / Image unavailable" width={node.width} y={node.height / 2 - 10} fontSize={16} align="center" fill="#555555" />}
  </Group>;
});

const LayoutNode = memo(function LayoutNode({ node, register, onSelect, onChange, onTextEdit, readOnly }) {
  const ref = useRef(null);
  useLayoutEffect(() => { register(node.id, ref.current); return () => register(node.id, null); }, [node.id, register]);
  const select = event => { event.cancelBubble = true; onSelect(node.id); };
  const transform = () => {
    const target = ref.current;
    const width = Math.min(8192, Math.max(1, node.width * target.scaleX())), height = Math.min(8192, Math.max(1, node.height * target.scaleY()));
    target.scale({ x: 1, y: 1 });
    onChange(node.id, { x: target.x(), y: target.y(), width, height, rotation: normalizedRotation(target.rotation()) });
  };
  const events = {
    ref, id: node.id, x: node.x, y: node.y, width: node.width, height: node.height,
    rotation: node.rotation, opacity: node.opacity, visible: node.visible, draggable: !readOnly && !node.locked,
    onClick: select, onTap: select, onDragStart: select,
    onDragEnd: event => onChange(node.id, { x: event.target.x(), y: event.target.y() }), onTransformEnd: transform,
    onDblClick: () => { if (node.type === "text" && !node.locked && !readOnly) onTextEdit(node.id, node.text); },
    onDblTap: () => { if (node.type === "text" && !node.locked && !readOnly) onTextEdit(node.id, node.text); },
  };
  // Text and rectangles already use the document's top-left origin. One native
  // shape replaces Group + hit Rect + painted node; scene/export geometry stays
  // unchanged. Images, ellipses and lines retain their compound local geometry.
  if (node.type === "text") return <Text {...layoutTextProps(node)} {...events} listening hitFunc={frameHit} />;
  if (node.type === "shape" && node.shape === "rectangle") return <Rect {...layoutShapeProps(node)} {...events} listening hitFunc={frameHit} />;
  return <Group {...events}>
    <Rect width={node.width} height={node.height} fill="#00000000" />
    {node.type === "image" && <ImageContent key={node.assetId} node={node} />}
    {node.type === "shape" && node.shape === "ellipse" && <Ellipse {...layoutShapeProps(node)} />}
    {node.type === "shape" && node.shape === "line" && <Line {...layoutShapeProps(node)} />}
  </Group>;
});

function LayoutCanvas({ page, selectedId, onSelect, onOperations, onCommitText = onOperations, controllerRef, onPendingChange, onDraftChange, onError, zoom = 1, readOnly = false, presentation = false }) {
  const host = useRef(null), nodes = useRef(new Map()), transformer = useRef(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const textEdit = useCanvasTextEdit({ page, readOnly, onCommit: onCommitText, onError, controllerRef, onPendingChange, onDraftChange });
  const editing = textEdit.draft?.nodeId;
  const selected = page.nodes.find(node => node.id === selectedId);
  const edited = (textEdit.draft?.pageId === page.id ? page.nodes.find(node => node.id === editing) : null) || textEdit.draft?.node;
  const padding = presentation ? 0 : 80;
  const fit = Math.min((size.width - padding) / page.width, (size.height - padding) / page.height);
  const scale = Math.max(presentation ? 0.0001 : 0.02, fit * zoom), x = (size.width - page.width * scale) / 2, y = (size.height - page.height * scale) / 2;
  useEffect(() => {
    let frame;
    const observer = new ResizeObserver(entries => {
      const rect = entries[0].contentRect;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setSize({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) }));
    });
    observer.observe(host.current);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, []);
  const register = useCallback((id, node) => { if (node) nodes.current.set(id, node); else nodes.current.delete(id); }, []);
  useLayoutEffect(() => {
    transformer.current?.nodes(!readOnly && selected && !selected.locked && !editing && nodes.current.get(selected.id) ? [nodes.current.get(selected.id)] : []);
    transformer.current?.getLayer()?.batchDraw();
  }, [selected, editing, readOnly, page.id]);
  const move = useCallback((nodeId, changes) => {
    if (!readOnly) onOperations([{ op: "setNode", pageId: page.id, nodeId, changes }]);
  }, [onOperations, page.id, readOnly]);
  return <div className="cw-layout-canvas" ref={host} tabIndex={0} role="region" aria-label="作品画布 / Artwork canvas" onKeyDown={event => {
    if (presentation) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target.isContentEditable) return;
    if (event.key === "Escape") onSelect(null);
    if (!readOnly && selected && !selected.locked && ["Delete", "Backspace"].includes(event.key)) {
      event.preventDefault(); onOperations([{ op: "removeNode", pageId: page.id, nodeId: selected.id }]); onSelect(null);
    }
    const offset = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!readOnly && selected && !selected.locked && offset) {
      event.preventDefault(); const distance = event.shiftKey ? 10 : 1;
      move(selected.id, { x: selected.x + offset[0] * distance, y: selected.y + offset[1] * distance });
    }
  }}>
    <Stage width={size.width} height={size.height} onMouseDown={event => { if (event.target === event.target.getStage()) onSelect(null); }} onTouchStart={event => { if (event.target === event.target.getStage()) onSelect(null); }}>
      <Layer listening={!presentation}><Group x={x} y={y} scaleX={scale} scaleY={scale}>
        <Rect width={page.width} height={page.height} fill={page.background} onClick={() => onSelect(null)} onTap={() => onSelect(null)} />
        <Group clipWidth={page.width} clipHeight={page.height}>
          {/* Keep Stage/Layer/measurement alive, but never reuse a page's
              gesture state for another page that happens to share node IDs. */}
          {page.nodes.map(node => <LayoutNode key={`${page.id}:${node.id}`} node={node} register={register} onSelect={onSelect} onChange={move} onTextEdit={textEdit.begin} readOnly={readOnly} />)}
        </Group>
        {!presentation && <Transformer ref={transformer} flipEnabled={false} rotateEnabled={!readOnly} borderStroke="#4f73ff" anchorStroke="#4f73ff" anchorFill="#ffffff" anchorSize={8} padding={2}
          boundBoxFunc={(oldBox, next) => Math.abs(next.width) < 4 || Math.abs(next.height) < 4 || Math.abs(next.width) > 8192 * scale || Math.abs(next.height) > 8192 * scale ? oldBox : next} />}
      </Group></Layer>
    </Stage>
    {edited && <textarea autoFocus value={textEdit.draft.text} readOnly={readOnly || edited.locked} maxLength={16000} aria-label="编辑选中文字 / Edit selected text" className="cw-canvas-text" onChange={event => textEdit.input(event.target.value)} onBlur={textEdit.blur}
      onCompositionStart={textEdit.compositionStart} onCompositionEnd={event => textEdit.compositionEnd(event.currentTarget.value)}
      onKeyDown={event => { if (event.nativeEvent.isComposing || textEdit.draft.composing) return; if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); textEdit.cancel(); } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); textEdit.tryCommit(); } }}
      style={{ left: x + edited.x * scale, top: y + edited.y * scale, width: edited.width * scale, height: Math.max(48, edited.height * scale), transform: `rotate(${edited.rotation}deg)`, fontFamily: fonts[edited.style.fontFamily], fontSize: edited.style.fontSize * scale, lineHeight: edited.style.lineHeight, fontWeight: edited.style.fontWeight, fontStyle: edited.style.fontStyle, letterSpacing: edited.style.letterSpacing * scale, color: edited.style.fill, textAlign: edited.style.align }} />}
  </div>;
}
export default memo(LayoutCanvas);
