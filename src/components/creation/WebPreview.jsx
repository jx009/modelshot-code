"use client";

import { lazy, memo, Suspense, useEffect, useRef, useState } from "react";
import { prepareWebPreviewDocument } from "@/lib/creation/web-preview";
import { createWebPreviewAssetLoader } from "@/lib/creation/client/web-preview-assets";
import { creationError } from "./creation-errors";
import WebPreviewViewport from "./WebPreviewViewport";
const InteractiveWebFrame = lazy(() => import("./InteractiveWebFrame"));

// Only committed content reaches this component. Typing never rebuilds srcDoc.
export default memo(function WebPreview({ content, pageId, mode, zh, onNavigate, loadAssets }) {
  const host = useRef(null);
  const previewStarted = useRef(false);
  const [localLoader] = useState(createWebPreviewAssetLoader);
  const loader = loadAssets || localLoader;
  const [interactive, setInteractive] = useState(false);
  const [state, setState] = useState({ key: null, srcDoc: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const file = content.files.find(file => file.id === pageId && file.kind === "html") || content.files.find(file => file.path === content.entryPath);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const prepareModules = interactive ? (await import("@/lib/creation/web-modules")).preparePreviewModules : undefined;
        if (controller.signal.aborted) return;
        const prepared = prepareWebPreviewDocument({ ...content, entryPath: file.path }, { interactive, prepareModules, rootEntryPath: content.entryPath });
        const identity = { key: content, pageId: file.id, interactive };
        // Show a cold static page before images arrive. Later edits keep the
        // previous picture until ready; scripts start only once, with all assets.
        if (!interactive && prepared.assetIds.length && !previewStarted.current) {
          const shell = prepared.render(new Map());
          previewStarted.current = true;
          setState({ ...identity, frameInteractive: false, srcDoc: shell, pending: true, error: null });
        }
        const images = await loader(prepared.assetIds, { signal: controller.signal });
        if (!controller.signal.aborted) {
          const srcDoc = prepared.render(images);
          previewStarted.current = true;
          setState({ ...identity, frameInteractive: interactive, srcDoc, paths: content.files.filter(item => item.kind === "html").map(item => item.path), pending: false, error: null });
        }
      } catch (error) { if (!controller.signal.aborted) setState(previous => ({ ...previous, key: content, pageId: file.id, interactive, pending: false, error })); }
    }, 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [content, file.id, file.path, attempt, interactive, loader]);
  const current = state.key === content && state.pageId === file.id && state.interactive === interactive;
  return <>
    <div className="cw-web-preview-mode">
      <button type="button" aria-pressed={interactive} onClick={() => setInteractive(value => !value)}>
        {interactive ? (zh ? "关闭交互运行" : "Stop interactive preview") : (zh ? "运行交互预览" : "Run interactive preview")}
      </button>
      {interactive && <span>{zh ? "脚本仅在隔离预览中运行，网络请求已禁用。" : "Scripts run in an isolated preview with network access disabled."}</span>}
    </div>
    <WebPreviewViewport hostRef={host} mode={mode} width={mode === "mobile" ? content.viewport.mobile : content.viewport.desktop}>
      {state.srcDoc && (state.frameInteractive && interactive ? <Suspense fallback={<p role="status">{zh ? "正在启动交互预览…" : "Starting interactive preview…"}</p>}><InteractiveWebFrame srcDoc={state.srcDoc} width={mode === "mobile" ? content.viewport.mobile : content.viewport.desktop} zh={zh} paths={state.paths} onNavigate={path => { if (!current || state.error) return; const target = content.files.find(item => item.path === path && item.kind === "html"); if (target) onNavigate?.(target.id); }} /></Suspense> : <iframe title={zh ? "网页预览" : "Website preview"} sandbox="" referrerPolicy="no-referrer" srcDoc={state.srcDoc} style={{ width: mode === "mobile" ? content.viewport.mobile : content.viewport.desktop }} />)}
      {(!current || state.pending || state.error) && <p className={state.srcDoc ? "cw-web-preview-status" : undefined} role={current && state.error ? "alert" : "status"}>{current && state.error ? creationError(state.error, zh) : zh ? "正在更新预览…" : "Updating preview…"}{current && state.error && <button onClick={() => setAttempt(value => value + 1)}>{zh ? "重试预览" : "Retry preview"}</button>}</p>}
    </WebPreviewViewport>
  </>;
});
