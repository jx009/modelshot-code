import { ArrowUpRight } from "lucide-react";
import Link from "@/components/ui/NavigationLink";
import { getCase } from "@/lib/commerce/catalog";
import CaseArtwork from "./CaseArtwork";

export default function StudioShowcase({ zh }) {
  return <div className="cr-showcase" aria-label={zh ? "精选视觉方向" : "Selected visual directions"}>
    <div className="cr-showcase-note"><span>THE CREATIVE POSSIBILITIES</span><span>↗ VOL. 01</span></div>
    <Link href="/explore/botanical-light" className="cr-showcase-main" aria-label={zh ? "探索自然光摄影" : "Explore botanical photography"}><CaseArtwork item={getCase("botanical-light")} zh={zh} priority /></Link>
    <Link href="/explore/red-motion" className="cr-showcase-front" aria-label={zh ? "探索运动品牌视觉" : "Explore sports campaigns"}><CaseArtwork item={getCase("red-motion")} zh={zh} priority /><ArrowUpRight size={20} /></Link>
    <div className="cr-showcase-caption"><span>IMAGE. IDEA. POSSIBILITY.</span><p>{zh ? "从一张图，打开无限可能。" : "One image. Endless possibilities."}</p></div>
  </div>;
}
