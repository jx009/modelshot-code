"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { memo } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowUpRight, Search, Sparkles } from "lucide-react";
import Link from "@/components/ui/NavigationLink";
import { INSPIRATION_CATEGORIES } from "@/lib/inspiration/presentation";
import InspirationCover from "./InspirationCover";
import { galleryRefreshDelay, readGalleryCache, writeGalleryCache } from "@/lib/inspiration/client-cache";
import { usePageVisible } from "@/components/ui/LocalNavigation";
import { api } from "@/lib/client-api";

const GalleryCard = memo(function GalleryCard({ item, mode, zh }) {
  return <Link href={`/explore/${item.id}`} className="ig-card" aria-label={zh ? item.title : item.titleEn || item.title}>
    <InspirationCover defer item={item} mode={mode} className="ig-cover" alt={zh ? item.title : item.titleEn || item.title}><span className="ig-use">{zh ? "以此创作" : "Create with this"}<ArrowUpRight size={14} /></span></InspirationCover>
  </Link>;
});

export default function InspirationGallery(props) {
  return <Suspense fallback={null}><Gallery {...props} /></Suspense>;
}
function Gallery({ zh, explore }) {
  const pageVisible = usePageVisible();
  const params = useSearchParams();
  const [gallery, setGallery] = useState(null), [error, setError] = useState(false), [reload, setReload] = useState(0), [category, setCategory] = useState(() => INSPIRATION_CATEGORIES.some(c => c[0] === params.get("category")) ? params.get("category") : "all"), [query, setQuery] = useState("");
  useEffect(() => {
    if (!pageVisible) return;
    const abort = new AbortController();
    let timer, refreshing = false;
    async function refresh() {
      if (refreshing || abort.signal.aborted) return;
      if (document.visibilityState === "hidden") return;
      refreshing = true;
      clearTimeout(timer);
      const remaining = galleryRefreshDelay();
      if (remaining > 0) {
        setGallery(readGalleryCache());
        setError(false);
        refreshing = false;
        timer = setTimeout(refresh, remaining);
        return;
      }
      let delay = 60000;
      try {
        const next = await api("/api/inspiration", { signal: abort.signal });
        if (abort.signal.aborted) return;
        writeGalleryCache(next);
        setGallery(next); setError(false);
        // Adopt newly mirrored images without a page reload; refresh signatures
        // before expiry for cards that have not scrolled into view yet.
        delay = next.deliveryPending ? 15000 : next.deliveryExpiresAt ? Math.max(10000, Math.min(60000, next.deliveryExpiresAt - Date.now() - 30000)) : 60000;
      } catch { if (!abort.signal.aborted) setError(true); }
      finally { refreshing = false; if (!abort.signal.aborted) timer = setTimeout(refresh, delay); }
    }
    // Restore public metadata after hydration, then revalidate in the background.
    // A refresh/navigation needn't blank the gallery during an overseas request.
    void Promise.resolve().then(() => {
      if (abort.signal.aborted) return;
      const cached = readGalleryCache();
      if (cached) setGallery(cached);
      void refresh();
    });
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { abort.abort(); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); clearTimeout(timer); };
  }, [reload, pageVisible]);
  const requestedCategory = params.get("category");
  const previousCategory = useRef(requestedCategory);
  useEffect(() => {
    if (!explore || !pageVisible || previousCategory.current === requestedCategory) return;
    previousCategory.current = requestedCategory;
    setCategory(INSPIRATION_CATEGORIES.some(category => category[0] === requestedCategory) ? requestedCategory : "all");
  }, [explore, pageVisible, requestedCategory]);
  if (!gallery) return <section className="ig-section"><p role={error ? "alert" : "status"}>{zh ? (error ? "灵感库暂时无法加载。" : "正在加载灵感作品…") : (error ? "The gallery is unavailable." : "Loading inspiration…")}</p>{error && <button onClick={() => setReload(v => v + 1)}>{zh ? "重试" : "Try again"}</button>}</section>;
  const visible = gallery.items.filter(i => (category === "all" || i.category === category) && `${i.title} ${i.titleEn} ${i.description} ${i.prompt}`.toLowerCase().includes(query.toLowerCase().trim()));
  const { layout } = gallery;
  return <section className="cr-inspiration ig-section">
    {error && <p role="status">{zh ? "刷新暂时失败，仍显示上次内容。" : "Refresh failed. Showing the previous content."}<button onClick={() => setReload(value => value + 1)}>{zh ? "重试" : "Try again"}</button></p>}
    <div className="cr-section-heading"><div><h2><Sparkles size={19} />{zh ? "灵感发现" : "Discover inspiration"}<span>{zh ? "让好想法，成为下一件作品" : "Find your next creative direction"}</span></h2></div>{!explore && <Link href="/explore">{zh ? "探索全部" : "Explore all"}<ArrowUpRight size={15} /></Link>}</div>
    <div className="cr-filter-bar"><div className="cr-categories" role="group" aria-label={zh ? "案例分类" : "Case categories"}>{INSPIRATION_CATEGORIES.map(([id, cn, en]) => <button key={id} className={category === id ? "active" : ""} onClick={() => setCategory(id)}>{zh ? cn : en}</button>)}</div><label className="cr-search"><Search size={15} /><input value={query} onChange={e => setQuery(e.target.value)} aria-label={zh ? "搜索灵感" : "Search inspiration"} placeholder={zh ? "搜索作品或提示词" : "Search images or prompts"} /></label></div>
    <div className={`ig-gallery ig-${layout.mode} ig-columns-${layout.columns}`} style={{ "--ig-columns": layout.columns, "--ig-gap": `${layout.gap}px` }}>{visible.map(item => <GalleryCard key={item.id} item={item} mode={layout.mode} zh={zh} />)}</div>
    {!visible.length && <div className="cr-no-results">{zh ? "暂时没有匹配的作品。" : "No matching works."}<button onClick={() => { setCategory("all"); setQuery(""); }}>{zh ? "查看全部" : "Show all"}</button></div>}
    <p className="cr-source-note">{zh ? "精选生成作品 · 完整提示词与来源见作品详情，带走灵感，创作自己的版本。" : "Generated artwork · Discover prompts and source credits in each case, and make it your own."}</p>
  </section>;
}
