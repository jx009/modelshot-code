// Lightweight display helpers: no validation schemas or bundled prompt catalogue.
export const INSPIRATION_CATEGORIES = [["all", "全部灵感", "All inspiration"], ["manga", "漫画叙事", "Comics"], ["poster", "创意海报", "Posters"], ["commerce", "产品广告", "Products"], ["fashion", "人像时尚", "Fashion"], ["illustration", "艺术插画", "Illustration"], ["threeD", "3D 实验", "3D studies"], ["space", "空间场景", "Spaces"]];
export function inspirationImage(item, thumbnail = false) {
  if (thumbnail && item.thumbnailUrl) return item.thumbnailUrl;
  if (item.imageUrl) return item.imageUrl;
  return item.cover.type === "builtin" ? `/inspiration/generated/${item.cover.file}${item.imageVersion ? `.${item.imageVersion}` : ""}.webp` : `/api/inspiration/${encodeURIComponent(item.id)}/image`;
}
export function inspirationLabel(item, zh = true) { const c = INSPIRATION_CATEGORIES.find(c => c[0] === item.category); return c?.[zh ? 1 : 2] || ""; }
export function coverAspect(item, mode = "masonry") {
  if (mode === "grid") return "1 / 1";
  return item.size.replace("x", " / ");
}
