"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client-api";
import { WEB_RUNTIME_CHANNEL, webRuntimeMessage } from "@/lib/creation/web-runtime";
import { creationError } from "./creation-errors";

function RuntimeFrame({ runtimeUrl, srcDoc, width, paths, onNavigate, zh }) {
  const frame = useRef(null), latest = useRef({ paths, onNavigate });
  const [ticket, setTicket] = useState(() => ({ token: crypto.randomUUID(), html: srcDoc })), [status, setStatus] = useState("loading");
  if (ticket.html !== srcDoc) {
    setTicket({ token: crypto.randomUUID(), html: srcDoc }); setStatus("loading");
  }
  useEffect(() => { latest.current = { paths, onNavigate }; }, [paths, onNavigate]);
  useEffect(() => {
    const token = ticket.token;
    let sent = false, rendered = false;
    const timer = setTimeout(() => setStatus("failed"), 15000);
    const receive = event => {
      const message = webRuntimeMessage(event, { source: frame.current?.contentWindow, token, paths: latest.current.paths });
      if (!message) return;
      if (message.type === "ready" && !sent) {
        sent = true;
        // Opaque sandbox origin requires '*'; source window, token and the
        // shell's configured parent-origin check bind the one-shot exchange.
        frame.current.contentWindow.postMessage({ channel: WEB_RUNTIME_CHANNEL, token, type: "render", html: srcDoc }, "*");
      } else if (message.type === "rendered" && sent && !rendered) {
        rendered = true; clearTimeout(timer); setStatus("ready");
      } else if (message.type === "navigate" && rendered) latest.current.onNavigate?.(message.path);
    };
    window.addEventListener("message", receive);
    return () => { clearTimeout(timer); window.removeEventListener("message", receive); };
  }, [runtimeUrl, srcDoc, ticket.token]);
  if (status === "failed") return <p role="alert">{zh ? "交互预览未能启动，请关闭后重试。" : "Interactive preview could not start. Close it and retry."}</p>;
  return <>{status === "loading" && <p role="status">{zh ? "正在启动交互预览…" : "Starting interactive preview…"}</p>}{ticket?.html === srcDoc && <iframe key={ticket.token} ref={frame} title={zh ? "网页交互预览" : "Interactive website preview"} src={`${runtimeUrl}#${ticket.token}`} sandbox="allow-scripts" referrerPolicy="no-referrer" style={{ width, visibility: status === "ready" ? "visible" : "hidden" }} />}</>;
}

export default function InteractiveWebFrame(props) {
  const [runtime, setRuntime] = useState(null), [error, setError] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    void api("/api/creation/preview-runtime", { signal: controller.signal }).then(value => {
      const url = new URL(value.url);
      if (value.appOrigin !== location.origin || url.origin === location.origin || !["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/api/creation-preview") throw new Error("CREATION_PREVIEW_ORIGIN_REQUIRED");
      if (!controller.signal.aborted) setRuntime(url.href);
    }).catch(failure => { if (!controller.signal.aborted) setError(failure); });
    return () => controller.abort();
  }, []);
  if (error) return <p role="alert">{creationError(error, props.zh)}</p>;
  return runtime ? <RuntimeFrame {...props} runtimeUrl={runtime} /> : <p role="status">{props.zh ? "正在连接预览服务…" : "Connecting to preview service…"}</p>;
}
