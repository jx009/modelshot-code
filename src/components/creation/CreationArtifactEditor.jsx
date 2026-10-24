"use client";

import { lazy, Suspense } from "react";
const Layout = lazy(() => import("./ArtifactEditor"));
const Web = lazy(() => import("./WebArtifactEditor"));
const Office = lazy(() => import("./OfficeArtifactEditor"));
export default function CreationArtifactEditor({ kind, ...props }) {
  const Editor = kind === "web" ? Web : ["document", "sheet"].includes(kind) ? Office : ["poster", "slides"].includes(kind) ? Layout : null;
  return Editor ? <Suspense fallback={<div className="cw-loading" role="status">{props.zh ? "正在打开编辑器…" : "Opening editor…"}</div>}><Editor kind={kind} {...props} /></Suspense>
    : <div className="cw-loading" role="status">{props.zh ? "此类型的编辑器尚未开放。" : "This editor is not available yet."}</div>;
}
