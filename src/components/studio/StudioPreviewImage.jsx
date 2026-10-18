"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LoaderCircle, RotateCcw } from "lucide-react";
import { getCachedImage, loadImage } from "@/lib/studio/image-processor";
import { imageUrl, previewUrl } from "@/lib/studio/image-url";

export default function StudioPreviewImage({ assetId, initialImage, zoom, zh }) {
  const viewport = useRef(null), content = useRef(null);
  const [display, setDisplay] = useState(() => {
    const original = getCachedImage(imageUrl(assetId));
    return { original: Boolean(original), image: original || getCachedImage(previewUrl(assetId, 1280)) || initialImage || getCachedImage(previewUrl(assetId, 640)) || getCachedImage(previewUrl(assetId, 320)) };
  });
  const [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const image = display.image;

  useEffect(() => {
    const full = new AbortController(), preview = new AbortController();
    const cached = getCachedImage(previewUrl(assetId, 1280));
    // Upgrade the small canvas preview while the much larger original downloads.
    if (!getCachedImage(imageUrl(assetId)) && !cached && Math.max(initialImage?.naturalWidth || 0, initialImage?.naturalHeight || 0) < 1280) {
      loadImage(previewUrl(assetId, 1280), { signal: preview.signal })
        .then(image => { if (!preview.signal.aborted) setDisplay(current => current.original ? current : { image, original: false }); })
        .catch(() => { /* The original can still succeed; keep any visible preview. */ });
    }
    loadImage(imageUrl(assetId), { signal: full.signal })
      .then(image => {
        if (full.signal.aborted) return;
        setDisplay({ image, original: true });
        preview.abort();
      })
      .catch(() => { if (!full.signal.aborted) setFailed(true); });
    return () => { full.abort(); preview.abort(); };
  }, [assetId, initialImage, attempt]);

  useLayoutEffect(() => {
    const element = viewport.current;
    const measure = () => setBounds({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!image) return;
    const host = content.current;
    // Mount the already-decoded image itself. A new <img src=...> can repeat
    // the private, no-store COS redirect and fetch the same original again.
    host.replaceChildren(image);
    host.firstElementChild.setAttribute("alt", zh ? "完整图片" : "Full image");
    host.firstElementChild.setAttribute("draggable", "false");
    return () => { if (image.parentNode === host) host.removeChild(image); };
  }, [image, zh]);

  const fit = image && bounds.width && bounds.height ? Math.min(bounds.width / image.naturalWidth, bounds.height / image.naturalHeight) : 1;
  const width = image ? Math.max(1, Math.round(image.naturalWidth * fit * zoom)) : 0;
  const height = image ? Math.max(1, Math.round(image.naturalHeight * fit * zoom)) : 0;
  return <div className="ms-preview-body" data-asset-id={assetId} data-quality={display.original ? "original" : image ? "preview" : "loading"}>
    <div ref={viewport} className="ms-preview-image">
      <div className="ms-preview-image-space" style={{ minWidth: width, minHeight: height }}>
        <div ref={content} className="ms-preview-image-content" style={{ width, height }} />
      </div>
    </div>
    {!display.original && <div className="ms-preview-status" role="status">
      {failed ? <><span>{image ? zh ? "原图加载失败，已保留预览" : "Original unavailable. Preview preserved." : zh ? "图片加载失败" : "Image failed to load"}</span><button onClick={() => { setFailed(false); setAttempt(value => value + 1); }}><RotateCcw size={13} />{zh ? "重试" : "Retry"}</button></> : <><LoaderCircle className="ms-spin" size={14} /><span>{image ? zh ? "正在加载原图…" : "Loading original…" : zh ? "正在加载预览…" : "Loading preview…"}</span></>}
    </div>}
  </div>;
}
