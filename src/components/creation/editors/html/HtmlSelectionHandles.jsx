"use client";

import { createPortal } from "react-dom";
export default function HtmlSelectionHandles({ box, resize, zh }) {
  if (!box || !box.width || !box.height) return null;
  return createPortal(<div className="cw-editor-selection" style={box}>{["nw", "ne", "sw", "se"].map(corner => <button key={corner} type="button" data-corner={corner} aria-label={(zh ? "拖动调整大小 " : "Drag to resize ") + corner} onPointerDown={event => resize.start(event, corner)} onPointerMove={resize.move} onPointerUp={() => resize.end()} onPointerCancel={() => resize.end(true)} onLostPointerCapture={() => resize.end(true)} />)}</div>, document.fullscreenElement || document.body);
}
