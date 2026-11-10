const ACTIVE = new Set(["queued", "running", "provider_pending", "reconciling", "cancel_requested"]);

export function jobSourceAssets(job) {
  return [...new Set([...(Array.isArray(job.inputAssetIds) ? job.inputAssetIds : [job.canvasOrigin?.assetId]), job.assetId, ...(job.referenceAssetIds || [])].filter(Boolean))];
}

export function jobSourceLayers(layers, job) {
  const targetId = job.canvasOrigin?.layerId || job.targetId;
  const target = layers.find(layer => layer.id === targetId);
  const sources = [];
  for (const assetId of jobSourceAssets(job)) {
    const layer = target?.assetId === assetId ? target : layers.find(item => item.assetId === assetId && item.sourceJobId !== job.id);
    if (layer && !sources.includes(layer.id)) sources.push(layer.id);
  }
  return sources;
}

export function nextResultPosition(layers, target, size) {
  const visible = layers.filter(layer => layer.visible !== false);
  const x = Math.min(99000, target ? target.x + target.width + 96 : Math.max(80, ...visible.map(layer => layer.x + layer.width)) + 50);
  let y = target?.y ?? 100;
  for (let i = 0; i <= visible.length; i++) {
    const collision = visible.find(layer => x < layer.x + layer.width + 24 && x + size.width + 24 > layer.x && y < layer.y + layer.height + 24 && y + size.height + 24 > layer.y);
    if (!collision) break;
    y = collision.y + collision.height + 48;
  }
  return { x, y: Math.min(99000, y) };
}

export function canvasVideoTasks(layers, jobs, appliedJobs = [], positions = {}) {
  const nodes = [], occupied = [...layers];
  for (const job of [...jobs].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.id.localeCompare(b.id))) {
    if (job.tool !== "video" || !ACTIVE.has(job.status) || appliedJobs.includes(job.id) || layers.some(layer => layer.sourceJobId === job.id)) continue;
    const sourceLayerIds = jobSourceLayers(layers, job);
    const source = layers.find(layer => layer.id === sourceLayerIds[0]);
    const width = 360, height = 220;
    const node = { id: `task-${job.id}`, jobId: job.id, width, height, ...(positions[job.id] || nextResultPosition(occupied, source, { width, height })), sourceLayerIds, status: job.status, cancelRequested: job.cancelRequested, visible: true };
    nodes.push(node); occupied.push(node);
  }
  return nodes;
}

export function reserveCanvasTasks(draft, jobs) {
  const nodes = canvasVideoTasks(draft.layers, jobs, draft.appliedJobs, draft.taskPositions);
  const missing = nodes.filter(node => !draft.taskPositions?.[node.jobId]);
  if (!missing.length) return draft;
  const keep = new Set(jobs.filter(job => !["failed", "cancelled"].includes(job.status)).map(job => job.id));
  const taskPositions = Object.fromEntries(Object.entries(draft.taskPositions || {}).filter(([id]) => keep.has(id) && !draft.appliedJobs?.includes(id)));
  for (const node of missing) taskPositions[node.jobId] = { x: node.x, y: node.y };
  return { ...draft, taskPositions };
}

export function lineageEdges(layers, pending = []) {
  const byId = new Map(layers.filter(layer => layer.visible !== false).map(layer => [layer.id, layer]));
  const edges = [];
  for (const result of [...byId.values(), ...pending]) {
    for (const sourceId of new Set(result.sourceLayerIds || [])) {
      const source = byId.get(sourceId);
      if (!source || source.id === result.id || result.sourceAssetIds?.length && !result.sourceAssetIds.includes(source.assetId)) continue;
      edges.push({ id: `${sourceId}:${result.id}`, source, result });
    }
  }
  return edges;
}
