// Shared by the agent and UI. All source and historical result layers survive
// saving or replanning. Stable result IDs also prevent duplicate canvas imports.
export function commerceContent(previous, commerce, sources = [], jobs = []) {
  const content = { schemaVersion: 1, layers: [], messages: [], jobs: [], appliedJobs: [], ...previous, commerce };
  const layers = [...content.layers];
  for (const [index, asset] of sources.filter(Boolean).entries()) {
    if (layers.some(l => l.assetId === asset.assetId)) continue;
    const width = asset.width || 1024, height = asset.height || 1024;
    layers.push({ id: `source-${asset.assetId}`, type: "image", name: index ? "Style reference" : "Product reference", assetId: asset.assetId, x: index * 550, y: 0, width: 500 * width / Math.max(width, height), height: 500 * height / Math.max(width, height), pixelWidth: width, pixelHeight: height, rotation: 0, visible: true, opacity: 1 });
  }
  const appliedJobs = new Set(content.appliedJobs);
  for (const job of jobs) {
    if (job.status !== "succeeded" || !job.sectionId) continue;
    const assets = job.resultData?.assets || [];
    for (const [index, asset] of assets.entries()) {
      const id = `result-${job.id}-${index}`;
      if (!asset.id || layers.some(l => l.id === id || l.sourceJobId === job.id && l.assetId === asset.id)) continue;
      const width = asset.width || 1024, height = asset.height || 1536;
      const right = Math.max(0, ...layers.map(l => l.x + l.width));
      layers.push({ id, type: "image", name: commerce.sections.find(s => s.id === job.sectionId)?.title || "Commerce result", assetId: asset.id, sourceJobId: job.id, x: right + 40, y: 0, width: 400, height: 400 * height / width, pixelWidth: width, pixelHeight: height, rotation: 0, visible: true, opacity: 1 });
    }
    if (assets.length) appliedJobs.add(job.id);
  }
  return { ...content, layers, jobs: [...new Set([...content.jobs, ...jobs.map(j => j.id)])].slice(-100), appliedJobs: [...appliedJobs] };
}

export function commerceReferences(commerce, section) {
  return [...new Set([commerce.referenceAssetId, section.revisionAssetId].filter(Boolean))];
}
