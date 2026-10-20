"use client";

import { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import BrandLogo from "@/components/BrandLogo";
import Modal from "@/components/ui/Modal";
import Link from "@/components/ui/NavigationLink";
import { preloadCanvas } from "@/lib/studio/preload-canvas";

export default function MobileNavigation({ links, path, zh }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef(null);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 601px)");
    const closeOnDesktop = () => { if (desktop.matches) setOpen(false); };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  return <>
    <button ref={trigger} className="cr-mobile-menu" aria-label={zh ? "打开导航菜单" : "Open navigation"} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(true)}><Menu size={20} /></button>
    {open && <Modal className="cr-mobile-drawer" label={zh ? "创作导航" : "Creative navigation"} onClose={() => setOpen(false)} returnFocusRef={trigger}>
      <header><Link href="/" prefetch="intent" className="cr-drawer-brand" aria-label="来塔绘梦" onClick={() => setOpen(false)}><BrandLogo /></Link><button className="cr-drawer-close" aria-label={zh ? "关闭导航菜单" : "Close navigation"} onClick={() => setOpen(false)}><X size={19} /></button></header>
      <p>{zh ? "创意工作空间" : "YOUR CREATIVE SPACE"}</p>
      <nav aria-label={zh ? "页面导航" : "Pages"}>{links.map(([href, Icon, cn, en]) => {
        const active = path === href || href === "/explore" && path.startsWith("/explore/");
        return <Link key={href} href={href} prefetch={active ? false : "intent"} onPrefetch={href === "/studio-v2" ? preloadCanvas : undefined} onClick={() => setOpen(false)} aria-current={active ? "page" : undefined}><Icon size={20} /><span>{zh ? cn : en}</span>{href === "/commerce" && <small>NEW</small>}</Link>;
      })}</nav>
      <footer>{zh ? "从灵感出发，让创作发生。" : "Start with inspiration. Make something yours."}</footer>
    </Modal>}
  </>;
}
