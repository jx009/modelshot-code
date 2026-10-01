"use client";
import { memo, useEffect, useRef, useState } from "react";
import { THEMES } from "@/lib/commerce/schema-client";
import { renderSection } from "@/lib/commerce/export";
const SectionPreview = memo(function SectionPreview({ section, brief, src }) {
  const ref = useRef(null), container = useRef(null), [error, setError] = useState("");
  const [nearby, setNearby] = useState(false), [width, setWidth] = useState(0), [rendered, setRendered] = useState(false);
  const painted = useRef(null);
  useEffect(() => {
    const element = container.current;
    let frame;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setWidth(Math.ceil(element.clientWidth * Math.min(window.devicePixelRatio || 1, 2))));
    };
    const resize = new ResizeObserver(measure);
    resize.observe(element);
    const intersection = new IntersectionObserver(entries => setNearby(entries[0].isIntersecting), { rootMargin: "200px 0px" });
    intersection.observe(element);
    return () => { resize.disconnect(); intersection.disconnect(); cancelAnimationFrame(frame); };
  }, []);
  useEffect(() => {
    if (!nearby || !width) return;
    const previous = painted.current;
    if (previous?.section === section && previous.brief === brief && previous.src === src && previous.width === width) return;
    const abort = new AbortController();
    renderSection(section, brief, src, { renderWidth: width, signal: abort.signal }).then(({ canvas }) => {
      if (abort.signal.aborted || !ref.current) return;
      ref.current.width = canvas.width; ref.current.height = canvas.height;
      ref.current.getContext("2d").drawImage(canvas, 0, 0); setError(""); setRendered(true);
      painted.current = { section, brief, src, width };
    }).catch(e => { if (!abort.signal.aborted) setError(e.message); });
    return () => abort.abort();
  }, [section, brief, src, nearby, width]);
  return <section ref={container} className="cm-rendered-section"><canvas ref={ref} width={1} height={1} data-rendered={rendered} className="cm-preview-render" role="img" aria-label={`${section.title} — ${section.body}`} />{error && <p className="cm-render-error" role="alert">{error === "TEXT_OVERFLOW" ? brief.language === "zh" ? "文案超出版式空间，请缩短后预览与导出。" : "Copy exceeds the available space. Shorten it to preview and export." : brief.language === "zh" ? "预览加载失败，请刷新重试。" : "Preview failed to load. Refresh to retry."}</p>}</section>;
});
export default function StoryPreview({ sections, brief, imageFor, compact = false }) {
  const theme = THEMES[brief.theme] || THEMES.linen;
  return <div className={`cm-story ${compact ? "compact" : ""}`} style={{ "--story-bg": theme.background, "--story-text": theme.text, "--story-muted": theme.muted, "--story-accent": theme.accent }}>{sections.map(s => <SectionPreview section={s} brief={brief} src={imageFor(s)} key={s.id} />)}</div>;
}
