"use client";

import { useEffect } from "react";

export function useDeleteSelection({ container, layers, selectedIds, onChange, onSelect, disabled }) {
  useEffect(() => {
    if (disabled) return;
    const remove = event => {
      if (!["Delete", "Backspace"].includes(event.key) || event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229) return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (!container.current || container.current.closest('[hidden], [inert]')) return;
      if (event.target?.isContentEditable || event.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], dialog, [role="dialog"]')) return;
      if (document.querySelector('dialog[open], [role="dialog"]')) return;
      const removable = new Set(layers.filter(layer => selectedIds.includes(layer.id) && layer.visible && !layer.locked).map(layer => layer.id));
      if (!removable.size) return;
      event.preventDefault();
      onChange(layers.filter(layer => !removable.has(layer.id)));
      onSelect(selectedIds.filter(id => !removable.has(id)));
    };
    window.addEventListener("keydown", remove);
    return () => window.removeEventListener("keydown", remove);
  }, [container, layers, selectedIds, onChange, onSelect, disabled]);
}
