"use client";
import { useEffect, useRef, useState } from "react";
import { THEMES } from "@/lib/commerce/schema-client";
import { renderSection } from "@/lib/commerce/export";
function SectionPreview({ section, brief, src }) {
  const ref = useRef(null), [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    renderSection(section, brief, src).then(({ canvas }) => { if (!cancelled && ref.current) { ref.current.width = canvas.width; ref.current.height = canvas.height; ref.current.getContext("2d").drawImage(canvas, 0, 0); setError(""); } }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [section, brief, src]);
  return <section className="cm-rendered-section"><canvas ref={ref} className="cm-preview-render" role="img" aria-label={`${section.title} — ${section.body}`} />{error && <p className="cm-render-error" role="alert">{error === "TEXT_OVERFLOW" ? brief.language === "zh" ? "文案超出版式空间，请缩短后预览与导出。" : "Copy exceeds the available space. Shorten it to preview and export." : brief.language === "zh" ? "预览加载失败，请刷新重试。" : "Preview failed to load. Refresh to retry."}</p>}</section>;
}
export default function StoryPreview({ sections, brief, imageFor, compact = false }) {
  const theme = THEMES[brief.theme] || THEMES.linen;
  return <div className={`cm-story ${compact ? "compact" : ""}`} style={{ "--story-bg": theme.background, "--story-text": theme.text, "--story-muted": theme.muted, "--story-accent": theme.accent }}>{sections.map(s => <SectionPreview section={s} brief={brief} src={imageFor(s)} key={s.id} />)}</div>;
}
