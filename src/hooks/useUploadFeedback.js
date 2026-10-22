"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IMAGE_UPLOAD_MAX_BYTES } from "@/lib/image-upload-limits";

export function useUploadFeedback(scope) {
  const [snapshot, setSnapshot] = useState({ scope, items: [] });
  const generation = useRef(0), urls = useRef(new Map());
  const release = useCallback(() => {
    generation.current++;
    for (const url of urls.current.values()) URL.revokeObjectURL(url);
    urls.current.clear();
  }, []);
  useEffect(() => release, [release, scope]);
  const start = useCallback(files => {
    release();
    const token = generation.current;
    const items = Array.from(files).map((file, index) => {
      const id = `${token}-${index}`;
      let url = "";
      if (["image/png", "image/jpeg", "image/webp"].includes(file.type) && file.size <= IMAGE_UPLOAD_MAX_BYTES && typeof URL.createObjectURL === "function") {
        try { url = URL.createObjectURL(file); urls.current.set(id, url); } catch {}
      }
      return { id, file, url, status: "queued" };
    });
    setSnapshot({ scope, items });
    const isCurrent = () => token === generation.current;
    const update = (index, status, error = "") => {
      if (!isCurrent()) return;
      const id = items[index].id;
      if (status === "done") {
        const url = urls.current.get(id);
        if (url) URL.revokeObjectURL(url);
        urls.current.delete(id);
      }
      setSnapshot(current => ({ ...current, items: status === "done" ? current.items.filter(item => item.id !== id) : current.items.map(item => item.id === id ? { ...item, status, error } : item) }));
    };
    const cancel = () => {
      if (!isCurrent()) return;
      release();
      setSnapshot({ scope, items: [] });
    };
    return { isCurrent, update, cancel };
  }, [release, scope]);
  const dismiss = useCallback(id => {
    const url = urls.current.get(id);
    if (url) URL.revokeObjectURL(url);
    urls.current.delete(id);
    setSnapshot(current => ({ ...current, items: current.items.filter(item => item.id !== id) }));
  }, []);
  return { items: snapshot.scope === scope ? snapshot.items : [], start, dismiss };
}
