"use client";

import { lazy, Suspense } from "react";
import BrandLoader from "@/components/ui/BrandLoader";
const loadLayout = () => import("./ArtifactEditor");
const Layout = lazy(loadLayout);
export function warmCreationEditor(kind) {
  if (["slides", "poster"].includes(kind)) void loadLayout().catch(() => {});
}
export default function CreationArtifactEditor({ kind, ...props }) {
  const Editor = ["poster", "slides"].includes(kind) ? Layout : null;
  return Editor ? <Suspense fallback={<BrandLoader variant="panel" label={props.zh ? "正在打开编辑器" : "Opening editor"} />}><Editor kind={kind} {...props} /></Suspense>
    : <div className="cw-loading" role="status">{props.zh ? "此类型已下线，仅支持 PPT。" : "This type is no longer supported. Only slides are available."}</div>;
}
