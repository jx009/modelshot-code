"use client";

import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";

// Geometry work stays inside the conversation; scrolling never updates the
// workspace/editor state. Observe size changes, not every mutation or token.
export default function ConversationViewport({ scrollRef, changeKey, visibilityKey, hasNewer, onLatest, zh, children }) {
  const viewport = useRef(null), content = useRef(null), pinned = useRef(true), anchor = useRef(null), frame = useRef(null);
  const [away, setAway] = useState(false);
  function bottom() {
    const element = viewport.current;
    if (element?.clientHeight) element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
  }
  function followLatest() { anchor.current = null; pinned.current = true; setAway(false); bottom(); }
  useImperativeHandle(scrollRef, () => ({
    followLatest,
    preserveHistory() {
      const element = viewport.current;
      if (!element?.clientHeight) return;
      const top = element.getBoundingClientRect().top;
      const first = [...element.querySelectorAll("[data-message-id]")].find(node => node.getBoundingClientRect().bottom > top);
      anchor.current = first ? { id: first.dataset.messageId, offset: first.getBoundingClientRect().top - top } : null;
      pinned.current = false; setAway(true);
    },
  }));
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element?.clientHeight) return;
    if (anchor.current) {
      const saved = anchor.current; anchor.current = null;
      const node = [...element.querySelectorAll("[data-message-id]")].find(node => node.dataset.messageId === saved.id);
      if (node) element.scrollTop += node.getBoundingClientRect().top - element.getBoundingClientRect().top - saved.offset;
    } else if (pinned.current) bottom();
  }, [changeKey, visibilityKey]);
  useEffect(() => {
    const element = viewport.current;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      if (!pinned.current || frame.current !== null || !element.clientHeight) return;
      frame.current = requestAnimationFrame(() => { frame.current = null; if (pinned.current) bottom(); });
    });
    observer?.observe(content.current); observer?.observe(element);
    return () => { observer?.disconnect(); if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null; };
  }, []);
  function scroll() {
    const element = viewport.current;
    if (!element.clientHeight) return;
    const near = element.scrollHeight - element.clientHeight - element.scrollTop <= 48;
    pinned.current = near; setAway(value => value === !near ? value : !near);
  }
  return <div className="cw-conversation-viewport"><div ref={viewport} className="cw-messages" onScroll={scroll} role="region" aria-label={zh ? "创作消息" : "Creation messages"} tabIndex={0}><div ref={content} className="cw-message-content">{children}</div></div>
    {(away || hasNewer) && <button type="button" className="cw-chat-jump" onClick={() => { if (hasNewer) onLatest(); else followLatest(); }}><ArrowDown size={14} />{zh ? "查看最新消息" : "View latest messages"}</button>}
  </div>;
}
