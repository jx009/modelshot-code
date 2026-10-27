"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { patchHtmlPreview } from "@/lib/creation/html/patch-preview";

// srcDoc is set once. Local edits patch the existing document so decoded images,
// focus, selection and the iframe itself survive instead of starting a new load.
export default function HtmlPreviewFrame({ html, revision = 0, frameRef, onUpdate, onBeforeUpdate, ...props }) {
  const [initial] = useState(html);
  const latest = useRef({ html, revision, onUpdate, onBeforeUpdate }), loaded = useRef(false), applied = useRef(initial), appliedRevision = useRef(revision);
  const synchronize = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!loaded.current || !doc) return;
    if (applied.current !== latest.current.html || appliedRevision.current !== latest.current.revision) {
      latest.current.onBeforeUpdate?.();
      patchHtmlPreview(doc, latest.current.html);
      applied.current = latest.current.html;
      appliedRevision.current = latest.current.revision;
    }
    latest.current.onUpdate();
  }, [frameRef]);
  // The parent's layout effect updates the editing handlers' latest page first.
  useEffect(() => {
    latest.current = { html, revision, onUpdate, onBeforeUpdate };
    synchronize();
  }, [html, revision, onUpdate, onBeforeUpdate, synchronize]);
  return <iframe {...props} ref={frameRef} sandbox="allow-same-origin" referrerPolicy="no-referrer" srcDoc={initial}
    onLoad={() => { loaded.current = true; applied.current = initial; synchronize(); }} />;
}
