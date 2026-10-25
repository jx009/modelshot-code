"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { patchHtmlPreview } from "@/lib/creation/html/patch-preview";

// srcDoc is set once. Local edits patch the existing document so decoded images,
// focus, selection and the iframe itself survive instead of starting a new load.
export default function HtmlPreviewFrame({ html, frameRef, onUpdate, ...props }) {
  const [initial] = useState(html);
  const latest = useRef({ html, onUpdate }), loaded = useRef(false), applied = useRef(initial);
  const synchronize = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!loaded.current || !doc) return;
    if (applied.current !== latest.current.html) {
      patchHtmlPreview(doc, latest.current.html);
      applied.current = latest.current.html;
    }
    latest.current.onUpdate();
  }, [frameRef]);
  // The parent's layout effect updates the editing handlers' latest page first.
  useEffect(() => {
    latest.current = { html, onUpdate };
    synchronize();
  }, [html, onUpdate, synchronize]);
  return <iframe {...props} ref={frameRef} sandbox="allow-same-origin" referrerPolicy="no-referrer" srcDoc={initial}
    onLoad={() => { loaded.current = true; applied.current = initial; synchronize(); }} />;
}
