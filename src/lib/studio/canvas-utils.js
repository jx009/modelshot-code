// Adapted from fancyboi999/Loomic apps/web/src/lib/canvas-elements.ts.
// Copyright (c) 2026 Xinmin Zeng. MIT; see THIRD_PARTY_NOTICES.md.
export function scaleToFit(width, height, maxSize) {
  if (width <= maxSize && height <= maxSize) return { width, height };
  const ratio = Math.min(maxSize / width, maxSize / height);
  return { width: Math.round(width * ratio), height: Math.round(height * ratio) };
}

export function isVideoUrl(url) {
  if (!url) return false;
  try { return [".mp4", ".webm", ".ogg", ".mov"].some(ext => new URL(url, "https://placeholder").pathname.toLowerCase().endsWith(ext)); }
  catch { return false; }
}

export function appendResult(layers, job, target) {
  const existing = new Set(layers.map(layer => layer.id));
  const assets = job.resultData?.assets || (job.asset ? [job.asset] : []);
  let right = Math.max(80, ...layers.map(layer => layer.x + layer.width)) + 50;
  const next = [...layers];
  for (const [index, asset] of assets.entries()) {
    const id = `${job.id}-${index}`;
    if (existing.has(id)) continue;
    const size = scaleToFit(asset.width || 768, asset.height || 432, 480);
    next.push({ id, type: asset.contentType === "video/mp4" ? "video" : "image", assetId: asset.id, name: asset.label || job.tool,
      x: right, y: target?.y || 100, ...size, rotation: 0, visible: true, opacity: 1, pixelWidth: asset.width || 768, pixelHeight: asset.height || 432, sourceJobId: job.id });
    right += size.width + 32;
  }
  return next;
}

export function historyPush(history, layers) {
  return { past: [...history.past, history.present].slice(-40), present: layers, future: [] };
}
