"use client";

import { lazy, Suspense, useEffect, useImperativeHandle, useState } from "react";
import { api } from "@/lib/client-api";
import { creationError } from "./creation-errors";

const Native = lazy(() => import("./NativeOfficeArtifactEditor"));
const Document = lazy(() => import("./DocumentArtifactEditor"));
const Sheet = lazy(() => import("./SheetArtifactEditor"));
const Conversion = lazy(() => import("./NativeOfficeConversion"));
function Pending({ editorRef, zh, error, retry }) {
  useImperativeHandle(editorRef, () => ({ flush: async () => { throw new Error("ARTIFACT_NOT_READY"); } }), []);
  return <div className="cw-loading" role={error ? "alert" : "status"}>{error ? creationError(error, zh) : zh ? "正在打开编辑器…" : "Opening editor…"}{error && <button onClick={retry}>{zh ? "重试" : "Retry"}</button>}</div>;
}
export default function OfficeArtifactEditor(props) {
  const { artifactId, userId, kind, zh, editorRef } = props;
  const [state, setState] = useState(null), [attempt, setAttempt] = useState(0);
  const identity = `${userId}:${artifactId}:${kind}:${attempt}`;
  useEffect(() => {
    const abort = new AbortController();
    void api(`/api/creation/artifacts/${encodeURIComponent(artifactId)}/format`, { signal: abort.signal }).then(format => {
      if (format.id !== artifactId || format.kind !== kind || ![1, 2].includes(format.schemaVersion)) throw new Error("ARTIFACT_FORMAT_UNSUPPORTED");
      if (!abort.signal.aborted) setState({ identity, format });
    }).catch(error => { if (!abort.signal.aborted) setState({ identity, error }); });
    return () => abort.abort();
  }, [identity, artifactId, kind]);
  const current = state?.identity === identity ? state : null;
  const pending = <Pending editorRef={editorRef} zh={zh} error={current?.error} retry={() => setAttempt(value => value + 1)} />;
  if (!current?.format) return pending;
  const Editor = current.format.schemaVersion === 2 ? Native : kind === "document" ? Document : Sheet;
  return <Suspense fallback={pending}>{current.format.schemaVersion === 1 && <Conversion key={`copy:${userId}:${artifactId}`} {...props} enabled={Boolean(current.format.canConvertNative)} />}<Editor key={`${userId}:${artifactId}`} {...props} canReferenceNative={Boolean(current.format.canReferenceNative)} /></Suspense>;
}
