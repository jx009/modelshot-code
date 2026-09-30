"use client";
import { useCallback, useEffect, useRef } from "react";
import { api } from "@/lib/client-api";
import { readProjectDraft, writeProjectDraft } from "@/lib/studio/project-storage";

export function useStudioView({ documentId, draftKey, userId, ready, canvas }) {
  const scope = useRef(null), timer = useRef(null), latest = useRef(null), saved = useRef(""), previous = useRef(null);
  const key = documentId || draftKey;
  useEffect(() => {
    if (!ready || !userId) return;
    let live = true;
    const adopted = previous.current?.draftKey === draftKey && !previous.current?.documentId && documentId;
    previous.current = { draftKey, documentId };
    scope.current = null;
    Promise.resolve().then(async () => {
      const local = adopted && latest.current || await readProjectDraft(userId, `view:${key}`).catch(() => null);
      const remote = !local && documentId ? await api(`/api/studio/documents/${documentId}/view`).catch(() => null) : null;
      if (!live) return;
      const camera = local || remote?.camera;
      const apply = () => {
        if (!live) return;
        if (!canvas.current) { timer.current = setTimeout(apply, 50); return; }
        // Receiving the first cloud ID does not open a different canvas.
        // Reapplying its in-flight camera here interrupts tool zooms and pans.
        if (!adopted) {
          if (camera) { saved.current = JSON.stringify(camera); canvas.current.restoreView(camera); }
          else canvas.current.fit();
        }
        scope.current = key;
        if (adopted && camera) { writeProjectDraft(userId, `view:${key}`, camera).catch(() => {}); api(`/api/studio/documents/${documentId}/view`, { method: "PUT", body: camera }).catch(() => {}); }
      };
      apply();
    });
    return () => { live = false; scope.current = null; clearTimeout(timer.current); };
  }, [key, draftKey, documentId, userId, ready, canvas]);
  const onCamera = useCallback(camera => {
    latest.current = camera;
    if (scope.current !== key || JSON.stringify(camera) === saved.current) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const value = latest.current;
      saved.current = JSON.stringify(value);
      writeProjectDraft(userId, `view:${key}`, value).catch(() => {});
      if (documentId) api(`/api/studio/documents/${documentId}/view`, { method: "PUT", body: value }).catch(() => {});
    }, 500);
  }, [userId, documentId, key]);
  return onCamera;
}
