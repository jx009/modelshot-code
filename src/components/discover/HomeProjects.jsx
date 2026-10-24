"use client";

import { useEffect, useRef, useState } from "react";
import { FolderOpen, ArrowUpRight } from "lucide-react";
import Link from "@/components/ui/NavigationLink";
import Image from "@/components/studio/AssetImage";
import { peekProjectList, readProjectList } from "@/lib/studio/project-list";
import { previewUrl } from "@/lib/studio/image-url";
import { projectHref } from "@/lib/creation/project-links";
import "./home-projects.css";

export default function HomeProjects({ userId, zh, visible }) {
  const [items, setItems] = useState(null), [error, setError] = useState(false), [attempt, setAttempt] = useState(0), [near, setNear] = useState(false);
  const host = useRef(null), query = "paged=1&scope=creation";
  useEffect(() => {
    if (!visible || !userId) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setNear(true); observer.disconnect(); } }, { rootMargin: "160px" });
    observer.observe(host.current); return () => observer.disconnect();
  }, [visible, userId]);
  useEffect(() => {
    if (!visible || !userId || !near) return;
    const controller = new AbortController();
    const cached = peekProjectList(userId, query);
    async function load() {
      if (cached) setItems(cached.items.slice(0, 8));
      try {
        const result = await readProjectList(userId, query, { signal: controller.signal });
        if (!controller.signal.aborted) { setItems(result.items.slice(0, 8)); setError(false); }
      } catch { if (!controller.signal.aborted) setError(true); }
    }
    void load(); return () => controller.abort();
  }, [userId, visible, near, attempt]);
  if (!userId) return null;
  return <section className="cr-home-projects" ref={host} aria-label={zh ? "我的项目" : "My projects"}>
    <header><h2>{zh ? "我的项目" : "My projects"}</h2><Link href="/projects">{zh ? "查看全部" : "View all"}<ArrowUpRight size={14} /></Link></header>
    {error && <p role="alert">{zh ? "项目读取失败" : "Could not load projects"}<button onClick={() => setAttempt(value => value + 1)}>{zh ? "重试" : "Retry"}</button></p>}
    <div className="cr-home-project-grid">{items === null ? Array.from({ length: 4 }, (_, index) => <div key={index} className="cr-home-project-placeholder" aria-hidden="true" />) : items.map(row => <Link key={`${row.source}:${row.id}`} href={projectHref(row)} className="cr-home-project-card"><div>{row.coverAssetId ? <Image src={previewUrl(row.coverAssetId, 640)} unoptimized fill sizes="(max-width:600px) 45vw, 240px" loading="lazy" alt="" /> : <FolderOpen size={32} strokeWidth={1} />}</div><strong>{row.name}</strong><time dateTime={row.updatedAt}>{new Date(row.updatedAt).toLocaleDateString(zh ? "zh-CN" : "en-US")}</time></Link>)}</div>
    {items?.length === 0 && <p>{zh ? "创作项目会自动保存在这里。" : "Your creative projects will be saved here."}</p>}
  </section>;
}
