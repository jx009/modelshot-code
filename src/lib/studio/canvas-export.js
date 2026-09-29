import { loadImage } from "./image-processor.js";
import { imageUrl } from "./image-url.js";

const xml = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]);
export function layeredSVG(layers, images, bounds) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}">${layers.map(layer => {
    const geometry = `transform="translate(${layer.x} ${layer.y}) rotate(${layer.rotation || 0})" opacity="${layer.opacity ?? 1}"`;
    const body = layer.type === "text"
      ? `<text fill="${xml(layer.fill || "#000000")}" font-family="Arial,sans-serif" font-size="${layer.fontSize || 36}" dominant-baseline="text-before-edge">${(layer.text || "").split("\n").map((line, i) => `<tspan x="0" y="${i * (layer.fontSize || 36)}">${xml(line)}</tspan>`).join("")}</text>`
      : `<image width="${layer.width}" height="${layer.height}" preserveAspectRatio="none" href="${images.get(layer.id)}"/>`;
    return `<g ${geometry}><title>${xml(layer.name)}</title>${body}</g>`;
  }).join("")}</svg>`;
}

export async function exportCanvas(artwork, layers, { format = "png", scope = "all", selectedId, name = "modelshot" } = {}) {
  const items = layers.filter(layer => layer.visible && layer.type !== "video" && (scope !== "selected" || layer.id === selectedId));
  if (!items.length) throw new Error("没有可导出的图像 / No images to export");
  const uniqueImages = [...new Map(items.filter(layer => layer.type === "image").map(layer => [layer.assetId, layer])).values()];
  const sourcePixels = uniqueImages.reduce((sum, item) => sum + (item.pixelWidth || item.width) * (item.pixelHeight || item.height), 0);
  if (sourcePixels > 80000000 || format === "psd" && items.reduce((sum, item) => sum + item.width * item.height, 0) > 80000000) throw new Error("图层过多，请分批选择导出 / Too much image data; export selected objects in smaller batches");
  const clone = artwork.clone();
  try {
    clone.find("Transformer").forEach(node => node.destroy());
    clone.getChildren().slice().forEach(node => { if (!items.some(item => item.id === node.id())) node.destroy(); });
    clone.scale({ x: 1, y: 1 }); clone.position({ x: 0, y: 0 });
    const box = clone.getClientRect(), bounds = { x: Math.floor(box.x), y: Math.floor(box.y), width: Math.ceil(box.x + box.width) - Math.floor(box.x), height: Math.ceil(box.y + box.height) - Math.floor(box.y) };
    if (bounds.width * bounds.height > 40000000 || Math.max(bounds.width, bounds.height) > 16000) throw new Error("导出范围过大 / Export area is too large");
    const byAsset = new Map();
    for (const item of uniqueImages) byAsset.set(item.assetId, await loadImage(imageUrl(item.assetId)));
    const originals = new Map(items.filter(item => item.type === "image").map(item => [item.id, byAsset.get(item.assetId)]));
    clone.find("Image").forEach(node => node.image(originals.get(node.id())));
    const composite = clone.toCanvas({ ...bounds, pixelRatio: 1 });
    let blob, extension = format;
    if (format === "psd") {
      const { writePsd } = await import("ag-psd");
      const children = items.map(item => {
        const node = clone.findOne(`#${item.id}`), rect = node.getClientRect();
        const left = Math.floor(rect.x), top = Math.floor(rect.y);
        const canvas = node.toCanvas({ x: left, y: top, width: Math.ceil(rect.x + rect.width) - left, height: Math.ceil(rect.y + rect.height) - top, pixelRatio: 1 });
        return { name: item.name, left: left - bounds.x, top: top - bounds.y, canvas };
      });
      blob = new Blob([writePsd({ width: bounds.width, height: bounds.height, canvas: composite, children })], { type: "image/vnd.adobe.photoshop" });
    } else if (format.startsWith("svg")) {
      extension = "svg";
      const images = new Map();
      for (const item of items.filter(layer => layer.type === "image")) {
        const original = originals.get(item.id), canvas = document.createElement("canvas");
        canvas.width = original.naturalWidth; canvas.height = original.naturalHeight;
        canvas.getContext("2d").drawImage(original, 0, 0); images.set(item.id, canvas.toDataURL("image/png"));
      }
      const svg = format === "svg-layers" ? layeredSVG(items, images, bounds) : `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}"><image width="100%" height="100%" href="${composite.toDataURL("image/png")}"/></svg>`;
      blob = new Blob([svg], { type: "image/svg+xml" });
    } else {
      if (format === "jpeg") {
        const ctx = composite.getContext("2d"); ctx.globalCompositeOperation = "destination-over"; ctx.fillStyle = "white"; ctx.fillRect(0, 0, composite.width, composite.height);
        extension = "jpg";
      }
      blob = await new Promise(resolve => composite.toBlob(resolve, `image/${format}`, .94));
      if (!blob || blob.type !== `image/${format}`) throw new Error("浏览器不支持此格式 / Browser does not support this format");
    }
    const url = URL.createObjectURL(blob), anchor = document.createElement("a");
    anchor.download = `${name.replace(/[<>:"/\\|?*]/g, "-").slice(0, 80)}.${extension}`; anchor.href = url; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } finally { clone.destroy(); }
}
