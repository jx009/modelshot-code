"use client";
import { useEffect, useRef } from "react";

export default function Modal({ children, onClose, label, className = "workflow-dialog", returnFocusRef }) {
  const ref = useRef(null);
  const backdropPress = useRef(false);
  useEffect(() => {
    const dialog = ref.current;
    const focused = document.activeElement;
    const returnTarget = returnFocusRef?.current || focused;
    dialog.showModal();
    return () => { dialog.close(); if (returnTarget?.isConnected) returnTarget.focus(); };
  }, [returnFocusRef]);
  function outside(event) {
    if (event.target !== event.currentTarget) return false;
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
  }
  return <dialog ref={ref} className={className} aria-label={label}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onPointerDown={event => { backdropPress.current = outside(event); }}
    onClick={event => { if (backdropPress.current && outside(event)) onClose(); backdropPress.current = false; }}>{children}</dialog>;
}
