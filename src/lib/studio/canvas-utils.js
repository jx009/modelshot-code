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
  const placement = job.resultData?.placement;
  const outputs = job.resultData?.assets || [];
  if (placement === "repair-background") {
    if (!outputs[0]) return layers;
    // Resolve only the pending background, never the moved object's coordinates.
    // If undo/delete removed it, the late result must not resurrect the group.
    return layers.map(layer => layer.id === `${job.id}-background` && layer.repairJobId === job.id && layer.layerRole === "background" && (!job.moveBundle || layer.assetId === job.moveBundle.holeAssetId)
      ? { ...layer, assetId: outputs[0].id, repairJobId: undefined } : layer);
  }
  if (["stack", "replace-source"].includes(placement)) {
    if (layers.some(layer => layer.sourceJobId === job.id)) return layers;
    if (!target || target.assetId !== job.assetId || !target.visible) {
      // Another edit may have replaced this source while the job was running.
      // Keep a completed full-image result as an alternative beside the work.
      if (placement === "replace-source") return appendResult(layers, { ...job, resultData: { ...job.resultData, placement: undefined } }, target);
      return layers;
    }
    const index = layers.findIndex(layer => layer.id === target.id);
    const created = outputs.map((asset, i) => ({ ...target, id: `${job.id}-${i}`, assetId: asset.id,
      name: asset.label || (placement === "stack" ? `${target.name} · ${i + 1}` : target.name),
      pixelWidth: asset.width, pixelHeight: asset.height, sourceJobId: job.id,
      ...(placement === "stack" ? { groupId: job.id, layerRole: "decomposed" } : {}), repairJobId: undefined }));
    if (!created.length) return layers;
    return [...layers.slice(0, index), { ...target, visible: false }, ...created, ...layers.slice(index + 1)];
  }
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

export function beginObjectMove(layers, target, job, bundle, offset) {
  if (!target || layers.some(layer => layer.sourceJobId === job.id)) return layers;
  const index = layers.findIndex(layer => layer.id === target.id && layer.assetId === target.assetId);
  if (index < 0) return layers;
  const bounds = bundle.bounds, radians = (target.rotation || 0) * Math.PI / 180;
  const x = (bounds.left + offset.dx) * target.width / target.pixelWidth;
  const y = (bounds.top + offset.dy) * target.height / target.pixelHeight;
  const background = { ...target, id: `${job.id}-background`, assetId: bundle.holeAssetId, name: `${target.name} · Background`, groupId: job.id, layerRole: "background", repairJobId: job.id, sourceJobId: job.id };
  const object = { ...target, id: `${job.id}-object`, assetId: bundle.objectAssetId, name: `${target.name} · Object`, groupId: job.id, layerRole: "object", sourceJobId: job.id,
    x: target.x + x * Math.cos(radians) - y * Math.sin(radians), y: target.y + x * Math.sin(radians) + y * Math.cos(radians),
    width: bounds.width * target.width / target.pixelWidth, height: bounds.height * target.height / target.pixelHeight, pixelWidth: bounds.width, pixelHeight: bounds.height, repairJobId: undefined };
  return [...layers.slice(0, index), { ...target, visible: false }, background, object, ...layers.slice(index + 1)];
}

export function historyPush(history, layers) {
  return { past: [...history.past, history.present].slice(-40), present: layers, future: [] };
}
