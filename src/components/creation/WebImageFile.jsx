"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { loadWebPreviewAssets } from "@/lib/creation/client/web-preview-assets";
import { webImageReference } from "@/lib/creation/client/web-image-files";
import { creationError } from "./creation-errors";

export default function WebImageFile({ file, page, pages, onPage, onInsert, readOnly, zh }) {
  const [state, setState] = useState(null), [visible, setVisible] = useState(true), [attempt, setAttempt] = useState(0);
  const text = (cn, en) => zh ? cn : en;
  useEffect(() => {
    const update = () => { const next = document.visibilityState !== "hidden"; setVisible(next); if (!next) setState(null); };
    update(); document.addEventListener("visibilitychange", update); return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    if (!visible) return;
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const images = await loadWebPreviewAssets([file.assetId], { signal: abort.signal });
        if (!abort.signal.aborted) setState({ assetId: file.assetId, url: images.get(file.assetId) });
      } catch (error) { if (!abort.signal.aborted) setState({ assetId: file.assetId, error }); }
    }, 120);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [file.assetId, visible, attempt]);
  const current = visible && state?.assetId === file.assetId;
  return <div className="cw-web-image-file">
    <div className="cw-web-image-preview">{current && state.url ? <Image unoptimized width={1280} height={1280} src={state.url} alt={file.path} onError={() => setState({ assetId: file.assetId, error: new Error("WEB_PREVIEW_ASSET_TYPE") })} /> : <p role={current && state.error ? "alert" : "status"}>{current && state.error ? creationError(state.error, zh) : text("正在读取图片…", "Loading image…")}</p>}
      {current && state.error && <button onClick={() => { setState(null); setAttempt(value => value + 1); }}>{text("重试图片预览", "Retry image preview")}</button>}
    </div>
    <label>{text("添加到页面", "Add to page")}<select aria-label={text("图片目标页面", "Image destination page")} disabled={readOnly} value={page.id} onChange={event => onPage(event.target.value)}>{pages.map(item => <option key={item.id} value={item.id}>{item.path}</option>)}</select></label>
    <button disabled={readOnly} onClick={onInsert}>{text("插入到页面末尾", "Insert at end of page")}</button>
    <label>{text("图片引用代码", "Image reference code")}<input aria-label={text("图片引用代码", "Image reference code")} readOnly value={`<img src="${webImageReference(file.path, page.path)}" alt="">`} onFocus={event => event.target.select()} /></label>
  </div>;
}
