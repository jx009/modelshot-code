"use client";

import { memo, useEffect, useRef, useState } from "react";
import { prepareWebPreviewDocument } from "@/lib/creation/web-preview";
import { loadWebPreviewAssets } from "@/lib/creation/client/web-preview-assets";
import { creationError } from "./creation-errors";
import WebPreviewViewport from "./WebPreviewViewport";

// Only committed content reaches this component. Typing never rebuilds srcDoc.
export default memo(function WebPreview({ content, pageId, mode, zh }) {
  const host = useRef(null);
  const [interactive, setInteractive] = useState(false);
  const [visible, setVisible] = useState(true), [state, setState] = useState({ key: null, srcDoc: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const file = content.files.find(file => file.id === pageId && file.kind === "html") || content.files.find(file => file.path === content.entryPath);
  useEffect(() => {
    let intersecting = true;
    const visibility = () => setVisible(intersecting && document.visibilityState !== "hidden");
    visibility();
    document.addEventListener("visibilitychange", visibility);
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => { intersecting = entries[0].isIntersecting; visibility(); });
    if (host.current) observer?.observe(host.current);
    return () => { observer?.disconnect(); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  useEffect(() => {
    if (!visible) { setState({ key: null, srcDoc: null, error: null }); return; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const prepared = prepareWebPreviewDocument({ ...content, entryPath: file.path }, { interactive });
        const images = await loadWebPreviewAssets(prepared.assetIds, { signal: controller.signal });
        if (!controller.signal.aborted) setState({ key: content, pageId: file.id, srcDoc: prepared.render(images), error: null });
      } catch (error) { if (!controller.signal.aborted) setState({ key: content, pageId: file.id, srcDoc: null, error }); }
    }, 120);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [content, file.id, file.path, visible, attempt, interactive]);
  const current = visible && state.key === content && state.pageId === file.id;
  return <>
    <div className="cw-web-preview-mode">
      <button type="button" aria-pressed={interactive} onClick={() => setInteractive(value => !value)}>
        {interactive ? (zh ? "关闭交互运行" : "Stop interactive preview") : (zh ? "运行交互预览" : "Run interactive preview")}
      </button>
      {interactive && <span>{zh ? "脚本仅在隔离预览中运行，网络请求已禁用。" : "Scripts run in an isolated preview with network access disabled."}</span>}
    </div>
    <WebPreviewViewport hostRef={host} mode={mode} width={mode === "mobile" ? content.viewport.mobile : content.viewport.desktop}>
      {current && state.srcDoc ? <iframe title={zh ? "网页预览" : "Website preview"} sandbox={interactive ? "allow-scripts" : ""} referrerPolicy="no-referrer" srcDoc={state.srcDoc} style={{ width: mode === "mobile" ? content.viewport.mobile : content.viewport.desktop }} />
        : <p role={state.error && current ? "alert" : "status"}>{current && state.error ? creationError(state.error, zh) : zh ? "正在准备预览…" : "Preparing preview…"}</p>}
      {current && state.error && <button onClick={() => { setState({ key: null, srcDoc: null, error: null }); setAttempt(value => value + 1); }}>{zh ? "重试预览" : "Retry preview"}</button>}
    </WebPreviewViewport>
  </>;
});
