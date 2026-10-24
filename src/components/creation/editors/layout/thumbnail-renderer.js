import Konva from "konva";
import { loadImage } from "@/lib/studio/image-processor";
import { previewUrl } from "@/lib/studio/image-url";
import { mapWithConcurrency } from "@/lib/map-with-concurrency";
import { imageFrame, layoutTextProps, layoutShapeProps } from "@/lib/creation/layout-rendering";

function yieldToBrowser(signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const cancel = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); resolve(); }, 0);
    signal.addEventListener("abort", cancel, { once: true });
  });
}

export async function renderPageThumbnail(page, signal) {
  const scale = Math.min(256 / page.width, 192 / page.height, 1), canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(page.width * scale)); canvas.height = Math.max(1, Math.ceil(page.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("CANVAS_UNAVAILABLE");
  let missingImages = false;
  try {
    context.fillStyle = page.background; context.fillRect(0, 0, canvas.width, canvas.height);
    const nodes = page.nodes.filter(node => node.visible);
    // Construct, paint and release small groups; no Stage, hit canvas or editor
    // exists for a thumbnail. Yield between groups so interaction can proceed.
    for (let offset = 0; offset < nodes.length; offset += 8) {
      await yieldToBrowser(signal);
      const batch = nodes.slice(offset, offset + 8), images = new Map();
      await mapWithConcurrency([...new Set(batch.filter(node => node.type === "image").map(node => node.assetId))], 2, async id => {
        try { images.set(id, await loadImage(previewUrl(id, 320), { signal, timeoutMs: 8000 })); }
        catch { signal.throwIfAborted(); missingImages = true; }
      });
      signal.throwIfAborted();
      const group = new Konva.Group({ listening: false });
      let raster;
      try {
        for (const node of batch) {
          const item = new Konva.Group({ x: node.x, y: node.y, rotation: node.rotation, opacity: node.opacity, listening: false });
          group.add(item);
          if (node.type === "text") item.add(new Konva.Text(layoutTextProps(node)));
          else if (node.type === "shape") {
            const Shape = node.shape === "ellipse" ? Konva.Ellipse : node.shape === "line" ? Konva.Line : Konva.Rect;
            item.add(new Shape(layoutShapeProps(node)));
          } else {
            item.clipWidth(node.width); item.clipHeight(node.height);
            item.add(new Konva.Rect({ width: node.width, height: node.height, fill: "#e7e7e7", listening: false }));
            const image = images.get(node.assetId);
            if (image) item.add(new Konva.Image({ image, ...imageFrame(image, node), listening: false }));
          }
        }
        raster = group.toCanvas({ x: 0, y: 0, width: page.width, height: page.height, pixelRatio: scale });
        context.drawImage(raster, 0, 0);
      } finally { group.destroy(); if (raster) { raster.width = 0; raster.height = 0; } }
    }
    signal.throwIfAborted();
    const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("THUMBNAIL_FAILED")), "image/png"));
    signal.throwIfAborted();
    return { blob, missingImages };
  } finally { canvas.width = 0; canvas.height = 0; }
}
