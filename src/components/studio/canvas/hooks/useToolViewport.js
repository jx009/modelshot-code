import { useCallback, useLayoutEffect, useRef } from "react";
import { editorCamera } from "@/lib/studio/editor-viewport";

export function useToolViewport({ container, selection, tool, padding, animateCamera, getCamera }) {
  const saved = useRef(null), layoutKey = useRef("");
  const focus = useCallback((surface, force = true) => {
    const panel = surface?.parentElement?.querySelector(".ms-editor");
    if (!panel || !selection || !surface.clientWidth || !surface.clientHeight) return;
    // offsetTop excludes the panel's entrance animation. Its actual height
    // includes hints, validation messages and a resized prompt field.
    const top = surface.clientWidth < 600 ? 108 : 66;
    // Desktop tools occupy a separate column. Only a bottom sheet overlaps
    // the stage; a side panel must not collapse the editable image's height.
    const docked = panel.offsetLeft >= surface.offsetLeft + surface.clientWidth;
    const bottom = docked ? surface.clientHeight - 76 : panel.offsetTop - 20;
    if (bottom <= top) return;
    const key = [tool, selection.id, selection.x, selection.y, selection.width, selection.height, selection.rotation, surface.clientWidth, surface.clientHeight, bottom].join(":");
    if (!force && key === layoutKey.current) return;
    layoutKey.current = key;
    animateCamera(editorCamera(selection, { left: 24, top, width: Math.max(1, surface.clientWidth - 48), height: bottom - top }, tool === "expand" ? padding : null));
  }, [selection, tool, padding, animateCamera]);

  useLayoutEffect(() => {
    if (!tool || !selection) {
      if (saved.current && saved.current.id === selection?.id) animateCamera(saved.current.camera);
      saved.current = null; layoutKey.current = "";
      return;
    }
    if (saved.current?.id !== selection.id) saved.current = { id: selection.id, camera: { ...getCamera() } };
    const surface = container.current, parent = surface?.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver(() => focus(surface, false));
    observer.observe(surface);
    let panel = null;
    const measurePanel = () => {
      const next = parent.querySelector(".ms-editor");
      if (next !== panel) {
        if (panel) observer.unobserve(panel);
        panel = next;
        if (panel) observer.observe(panel);
        layoutKey.current = "";
      }
      focus(surface, false);
    };
    // ToolPanel is loaded on demand and can mount after this layout effect.
    // Watch only direct siblings, rather than polling or observing the canvas tree.
    const mounts = new MutationObserver(measurePanel);
    mounts.observe(parent, { childList: true });
    measurePanel();
    return () => { mounts.disconnect(); observer.disconnect(); };
  }, [tool, selection, container, focus, getCamera, animateCamera]);

  return () => focus(container.current);
}
