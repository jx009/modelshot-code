"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import { ArrowUpRight, Megaphone, X } from "lucide-react";
import { announcementLink, safeAnnouncementUrl } from "@/lib/announcements";

export function AnnouncementContent({ announcement: a, locale = "zh", onClose }) {
  const en = locale === "en";
  const title = en && a.titleEn ? a.titleEn : a.title;
  const content = en && a.contentEn ? a.contentEn : a.content;
  return <div className="announcement-content" data-style={a.style}>
    <Megaphone size={14} className="announcement-icon" aria-hidden="true" />
    <div className="announcement-copy"><strong>{title}</strong>{content && <span>{content}</span>}</div>
    {a.buttonUrl && safeAnnouncementUrl(a.buttonUrl) && <a className="announcement-link" href={announcementLink(a.buttonUrl, locale)} target={a.buttonUrl.startsWith("/") ? undefined : "_blank"} rel="noopener noreferrer">{en ? a.buttonTextEn || a.buttonText : a.buttonText}<ArrowUpRight size={12} aria-hidden="true" /></a>}
    {a.closable && <button type="button" className="announcement-close" onClick={onClose} aria-label={en ? "Dismiss announcement" : "关闭公告"}><X size={15} /></button>}
  </div>;
}

export default function AnnouncementBanner() {
  const locale = useLocale();
  const pathname = usePathname();
  const admin = /^\/admin(\/|$)/.test(pathname);
  const [announcement, setAnnouncement] = useState(null);
  const [dismissed, setDismissed] = useState(null);
  const banner = useRef(null);
  const token = announcement ? `${announcement.id}:${announcement.revision}` : null;
  const visible = !admin && announcement && (!announcement.closable || dismissed !== token);

  useEffect(() => {
    if (admin) return;
    let active = true, controller;
    async function refresh() {
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch("/api/announcements/current", { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const { announcement: item } = await response.json();
        if (!active) return;
        setAnnouncement(item || null);
        try { setDismissed(item && sessionStorage.getItem(`letai:announcement:${item.id}`) === item.revision ? `${item.id}:${item.revision}` : null); } catch { /* Storage may be disabled. */ }
      } catch { /* An unavailable announcement must not block creation. */ }
    }
    void refresh();
    const timer = setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("announcements-updated", refresh);
    return () => { active = false; controller?.abort(); clearInterval(timer); window.removeEventListener("focus", refresh); window.removeEventListener("announcements-updated", refresh); };
  }, [admin]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    function measure() {
      root.style.setProperty("--site-announcement-height", `${visible ? banner.current?.getBoundingClientRect().height || 0 : 0}px`);
      root.toggleAttribute("data-announcement", Boolean(visible));
    }
    measure();
    const observer = new ResizeObserver(measure);
    if (banner.current) observer.observe(banner.current);
    return () => { observer.disconnect(); root.style.removeProperty("--site-announcement-height"); root.removeAttribute("data-announcement"); };
  }, [visible, announcement, locale]);

  if (!visible) return null;
  function dismiss() {
    setDismissed(token);
    try { sessionStorage.setItem(`letai:announcement:${announcement.id}`, announcement.revision); } catch { /* Optional persistence. */ }
  }
  return <><div className="announcement-spacer" aria-hidden="true" /><section ref={banner} className="site-announcement" aria-label={locale === "zh" ? "网站公告" : "Site announcement"}><AnnouncementContent announcement={announcement} locale={locale} onClose={dismiss} /></section></>;
}
