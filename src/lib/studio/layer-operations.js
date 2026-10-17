export function selectedLayerIds(layers, current, id, additive = false) {
  if (!id) return additive ? current : [];
  const target = layers.find(layer => layer.id === id);
  const ids = target?.selectionGroup ? layers.filter(layer => layer.selectionGroup === target.selectionGroup && layer.visible).map(layer => layer.id) : [id];
  if (!additive) return ids;
  return ids.every(key => current.includes(key)) ? current.filter(key => !ids.includes(key)) : [...new Set([...current, ...ids])];
}
function bounds(layer) {
  const angle = (layer.rotation || 0) * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  const points = [[0,0],[layer.width,0],[0,layer.height],[layer.width,layer.height]].map(([x,y]) => ({ x: layer.x + x*cos-y*sin, y: layer.y+x*sin+y*cos }));
  return { left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)), top: Math.min(...points.map(p => p.y)), bottom: Math.max(...points.map(p => p.y)) };
}
export function layersInRect(layers, rect) {
  const hits = layers.filter(layer => {
    if (!layer.visible || layer.locked) return false;
    const box = bounds(layer);
    return box.right >= rect.x && box.left <= rect.x + rect.width && box.bottom >= rect.y && box.top <= rect.y + rect.height;
  });
  const groups = new Set(hits.map(layer => layer.selectionGroup).filter(Boolean));
  return layers.filter(layer => layer.visible && !layer.locked && (hits.includes(layer) || groups.has(layer.selectionGroup))).map(layer => layer.id);
}
export function alignLayers(layers, ids, axis) {
  const chosen = layers.filter(l => ids.includes(l.id) && !l.locked);
  if (chosen.length < 2) return layers;
  const boxes = chosen.map(bounds);
  const left = Math.min(...boxes.map(b => b.left)), right = Math.max(...boxes.map(b => b.right)), top = Math.min(...boxes.map(b => b.top)), bottom = Math.max(...boxes.map(b => b.bottom));
  return layers.map(layer => {
    if (!chosen.includes(layer)) return layer;
    const b = bounds(layer);
    return { ...layer, x: layer.x + (axis === "left" ? left-b.left : axis === "center" ? (left+right-b.left-b.right)/2 : axis === "right" ? right-b.right : 0), y: layer.y + (axis === "top" ? top-b.top : axis === "middle" ? (top+bottom-b.top-b.bottom)/2 : axis === "bottom" ? bottom-b.bottom : 0) };
  });
}
export function distributeLayers(layers, ids) {
  const chosen = layers.filter(l => ids.includes(l.id) && !l.locked).sort((a,b) => bounds(a).left-bounds(b).left);
  if (chosen.length < 3) return layers;
  const boxes = chosen.map(bounds), first = boxes[0].left, last = boxes.at(-1).right;
  const gap = (last-first-boxes.reduce((sum,b) => sum+b.right-b.left,0))/(chosen.length-1);
  let cursor = first;
  const positions = new Map(chosen.map((layer,i) => { const x = layer.x + cursor-boxes[i].left; cursor += boxes[i].right-boxes[i].left+gap; return [layer.id,x]; }));
  return layers.map(layer => positions.has(layer.id) ? { ...layer, x: positions.get(layer.id) } : layer);
}
