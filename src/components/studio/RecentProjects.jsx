"use client";
import { useEffect, useRef, useState } from "react";
import { History, FolderOpen, X } from "lucide-react";
import Link from "@/components/ui/NavigationLink";
import { peekProjectList, readProjectList } from "@/lib/studio/project-list";
import { usePageVisible } from "@/components/ui/LocalNavigation";
import "./recent-projects.css";

export default function RecentProjects({ zh, onChoose, disabled, userId }) {
  const visible = usePageVisible();
  const [open, setOpen] = useState(false), [snapshot, setSnapshot] = useState({ userId: null, rows: null }), [error, setError] = useState("");
  const rows = snapshot.userId === userId ? snapshot.rows : null;
  const root = useRef(null), trigger = useRef(null);
  useEffect(() => {
    if (!open || !userId || !visible) return;
    const abort = new AbortController();
    readProjectList(userId, "paged=1", { signal: abort.signal }).then(data => {
      if (!abort.signal.aborted) setSnapshot({ userId, rows: data.items });
    }).catch(err => { if (!abort.signal.aborted) setError(err.message); });
    const close = event => { if (event.type === "keydown" ? event.key === "Escape" : !root.current?.contains(event.target)) { setOpen(false); if (event.type === "keydown") trigger.current?.focus(); } };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", close);
    return () => { abort.abort(); document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", close); };
  }, [open, userId, visible]);
  return <div className="mr-recent" ref={root}><button className="mr-trigger" disabled={disabled || !userId} ref={trigger} aria-label={zh ? "最近项目" : "Recent projects"} aria-expanded={open} onClick={() => { if (!open) setSnapshot({ userId, rows: peekProjectList(userId)?.items ?? null }); setOpen(value => !value); setError(""); }}><History size={18} /></button>{open && <section className="mr-popover" aria-label={zh ? "我的项目库" : "Project library"}><header><strong>{zh ? "我的项目库" : "Project library"}</strong><button aria-label={zh ? "关闭最近项目" : "Close recent projects"} onClick={() => setOpen(false)}><X size={16} /></button></header>{error ? <p role="alert">{error}</p> : rows === null ? <p>{zh ? "正在加载…" : "Loading…"}</p> : !rows.length ? <p>{zh ? "还没有项目" : "No projects yet"}</p> : <div className="mr-list">{rows.map((row, i) => {
    const date = new Date(row.updatedAt), day = date.toLocaleDateString(), today = day === new Date().toLocaleDateString();
    const label = today ? zh ? "今日" : "Today" : date.toLocaleDateString(zh ? "zh-CN" : "en-US", { month: "short", day: "numeric" });
    const child = <><FolderOpen size={16} /><span>{row.name}</span><time>{date.toLocaleTimeString(zh ? "zh-CN" : "en-US", { hour: "2-digit", minute: "2-digit" })}</time></>;
    return <div key={row.id}>{(!i || new Date(rows[i - 1].updatedAt).toLocaleDateString() !== day) && <h3>{label}</h3>}{onChoose && row.kind !== "commerce" ? <button onClick={() => { setOpen(false); onChoose(row.id); }}>{child}</button> : <Link href={`/${row.kind === "commerce" ? "commerce" : "studio-v2"}?document=${row.id}`}>{child}</Link>}</div>;
  })}</div>}<Link className="mr-all" href="/projects">{zh ? "查看全部项目" : "View all projects"}</Link></section>}</div>;
}
