import Image from "next/image";
import { ArrowUpRight, Check } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { getCase } from "@/lib/commerce/catalog";
import CaseArtwork from "@/components/discover/CaseArtwork";

const DIRECTIONS = [
  { id: "natural", caseId: "quiet-living", cn: "自然生活", en: "Natural living", theme: "linen", image: "chair" },
  { id: "editorial", caseId: "red-motion", cn: "先锋杂志", en: "Editorial energy", theme: "red", image: "sneaker" },
  { id: "studio", caseId: "after-dark", cn: "光影影棚", en: "Studio light", theme: "dark", image: "camera" },
];
export default function DirectionBoard({ item, draft, zh, onSelect }) {
  const direction = DIRECTIONS.find(d => d.id === draft.brief.style) || DIRECTIONS[0];
  const current = item.style === direction.id ? item : getCase(direction.caseId);
  return <aside className="cm-direction-board">
    <div className="cm-board-label"><span>ART DIRECTION / 01</span><span>{zh ? "给你的产品，找一种表达" : "Find your visual language"}</span></div>
    <div className={`cm-board-art cm-board-${draft.brief.style}`}>
      {draft.product ? <div className="cm-product-proof"><Image unoptimized src={`/api/assets/${draft.product.assetId}`} fill sizes="(max-width:900px) 90vw, 48vw" alt={zh ? "你的商品原图" : "Your original product"} /><span>{draft.brief.brand || "YOUR NEXT STORY"}</span><strong>{draft.brief.product}</strong><small>{zh ? "商品原图 · 尚未生成" : "Original product · Not generated"}</small></div> : <CaseArtwork item={current} zh={zh} priority />}
      <span className="cm-board-sticker">MAKE<br /><em>it yours.</em><ArrowUpRight size={22} /></span>
    </div>
    <div className="cm-art-directions" role="group" aria-label={zh ? "视觉方向" : "Art direction"}>{DIRECTIONS.map(d => <button key={d.id} aria-pressed={draft.brief.style === d.id} onClick={() => onSelect(d.id, d.theme)}><Image src={`/inspiration/${d.image}.webp`} alt="" width={90} height={90} /><span>{zh ? d.cn : d.en}<small>{d.id.toUpperCase()}</small></span>{draft.brief.style === d.id && <Check size={14} />}</button>)}</div>
    <div className="cm-board-bottom"><p>{zh ? "先找到感觉，再让创意发生。" : "Find the feeling. Make it happen."}</p><Link href="/explore">{zh ? "浏览更多灵感" : "More inspiration"}<ArrowUpRight size={14} /></Link></div>
    <small className="cm-board-source">{zh ? "摄影与版式参考，非 AI 生成效果。" : "Photography and layout reference, not AI output."}</small>
  </aside>;
}
