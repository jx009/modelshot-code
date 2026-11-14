"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { memo } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowUpRight, Search, Sparkles } from "lucide-react";
import Link from "@/components/ui/NavigationLink";
import { INSPIRATION_CATEGORIES } from "@/lib/inspiration/presentation";
import { inspirationColumns, mixInspirationItems } from "@/lib/inspiration/display-order";
import InspirationCover from "./InspirationCover";
import { galleryRefreshDelay, readGalleryCache, writeGalleryCache } from "@/lib/inspiration/client-cache";
import { usePageVisible } from "@/components/ui/LocalNavigation";
import { api } from "@/lib/client-api";

const GalleryCard = memo(function GalleryCard({ item, mode, zh }) {
  return <Link href={`/explore/${item.id}`} className="ig-card" aria-label={zh ? item.title : item.titleEn || item.title}>
    <InspirationCover defer item={item} mode={mode} className="ig-cover" alt={zh ? item.title : item.titleEn || item.title}>
      <span className="ig-overlay" aria-hidden="true">
        <span className="ig-overlay-copy"><b>{zh ? item.title : item.titleEn || item.title}</b><small>{zh ? item.promptZh || item.prompt : item.prompt}</small></span>
        <span className="ig-use">{zh ? "做同款" : "Remix"}<ArrowUpRight size={14} /></span>
      </span>
    </InspirationCover>
  </Link>;
});

function MasonryGallery({ items, layout, zh }) {
  const root = useRef(null);
  const [geometry, setGeometry] = useState(null);
  useEffect(() => {
    const node = root.current;
    const measure = () => {
      const style = getComputedStyle(node);
      const columns = Number(style.getPropertyValue("--ig-columns")) || layout.columns;
      const gap = parseFloat(style.getPropertyValue("--ig-gap")) || layout.gap;
      const width = (node.clientWidth - gap * (columns - 1)) / columns;
      const gapRatio = width > 0 ? gap / width : 0.05;
      setGeometry(previous => previous?.columns === columns && previous.gapRatio === gapRatio ? previous : { columns, gapRatio });
    };
    const frame = requestAnimationFrame(measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(node);
    window.addEventListener("resize", measure);
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [layout.columns, layout.gap]);
  const columns = useMemo(() => inspirationColumns(items, geometry?.columns || layout.columns, geometry?.gapRatio), [items, geometry, layout.columns]);
  return <div ref={root} className={`ig-gallery ig-masonry ig-columns-${layout.columns}`} style={{ "--ig-columns": layout.columns, "--ig-gap": `${layout.gap}px` }}>
    {columns.map((column, index) => <div key={index} className="ig-masonry-column">{column.map(item => <GalleryCard key={item.id} item={item} mode="masonry" zh={zh} />)}</div>)}
  </div>;
}

export default function InspirationGallery(props) {
  return <Suspense fallback={null}><Gallery {...props} /></Suspense>;
}
function Gallery({ zh }) {
  const pageVisible = usePageVisible();
  const params = useSearchParams();
  const [gallery, setGallery] = useState(null), [error, setError] = useState(false), [reload, setReload] = useState(0), [category, setCategory] = useState(() => INSPIRATION_CATEGORIES.some(c => c[0] === params.get("category")) ? params.get("category") : "all"), [query, setQuery] = useState("");
  const mixedItems = useMemo(() => mixInspirationItems(gallery?.items || []), [gallery?.items]);
  const galleryReady = Boolean(gallery);
  useEffect(() => {
    if (!pageVisible || !galleryReady || window.location.hash !== "#inspiration") return;
    // Returning from a detail can reveal a retained, previously hidden home.
    const frame = requestAnimationFrame(() => document.getElementById("inspiration")?.scrollIntoView());
    return () => cancelAnimationFrame(frame);
  }, [pageVisible, galleryReady]);
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
    if (!pageVisible || previousCategory.current === requestedCategory) return;
    previousCategory.current = requestedCategory;
    setCategory(INSPIRATION_CATEGORIES.some(category => category[0] === requestedCategory) ? requestedCategory : "all");
  }, [pageVisible, requestedCategory]);
  if (!gallery) return <section id="inspiration" className="ig-section"><p role={error ? "alert" : "status"}>{zh ? (error ? "灵感库暂时无法加载。" : "正在加载灵感作品…") : (error ? "The gallery is unavailable." : "Loading inspiration…")}</p>{error && <button onClick={() => setReload(v => v + 1)}>{zh ? "重试" : "Try again"}</button>}</section>;
  const visible = (category === "all" ? mixedItems : gallery.items).filter(i => (category === "all" || i.category === category) && `${i.title} ${i.titleEn} ${i.description} ${i.prompt}`.toLowerCase().includes(query.toLowerCase().trim()));
  const { layout } = gallery;
  return <section id="inspiration" className="cr-inspiration ig-section">
    {error && <p role="status">{zh ? "刷新暂时失败，仍显示上次内容。" : "Refresh failed. Showing the previous content."}<button onClick={() => setReload(value => value + 1)}>{zh ? "重试" : "Try again"}</button></p>}
    <div className="cr-section-heading"><div><h2><Sparkles size={18} />{zh ? "灵感发现" : "Discover"}</h2><p>{zh ? "社区精选作品，点开即可查看提示词并一键做同款" : "Curated works. Open any piece to see its prompt and remix it."}</p></div></div>
    <div className="cr-filter-bar"><div className="cr-categories" role="group" aria-label={zh ? "案例分类" : "Case categories"}>{INSPIRATION_CATEGORIES.map(([id, cn, en]) => <button key={id} className={category === id ? "active" : ""} onClick={() => setCategory(id)}>{zh ? cn : en}</button>)}</div><label className="cr-search"><Search size={15} /><input value={query} onChange={e => setQuery(e.target.value)} aria-label={zh ? "搜索灵感" : "Search inspiration"} placeholder={zh ? "搜索作品或提示词" : "Search images or prompts"} /></label></div>
    {layout.mode === "masonry" ? <MasonryGallery items={visible} layout={layout} zh={zh} /> : <div className={`ig-gallery ig-grid ig-columns-${layout.columns}`} style={{ "--ig-columns": layout.columns, "--ig-gap": `${layout.gap}px` }}>{visible.map(item => <GalleryCard key={item.id} item={item} mode={layout.mode} zh={zh} />)}</div>}
    {!visible.length && <div className="cr-no-results">{zh ? "暂时没有匹配的作品。" : "No matching works."}<button onClick={() => { setCategory("all"); setQuery(""); }}>{zh ? "查看全部" : "Show all"}</button></div>}
    <p className="cr-source-note">{zh ? "精选生成作品 · 完整提示词与来源见作品详情，带走灵感，创作自己的版本。" : "Generated artwork · Discover prompts and source credits in each case, and make it your own."}</p>
  </section>;
}
