"use client";
import { useEffect, useRef } from "react";

export default function Modal({ children, onClose, label, className = "workflow-dialog", returnFocusRef }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    const focused = document.activeElement;
    const returnTarget = returnFocusRef?.current || focused;
    dialog.showModal();
    return () => { dialog.close(); if (returnTarget?.isConnected) returnTarget.focus(); };
  }, [returnFocusRef]);
  return <dialog ref={ref} className={className} aria-label={label} onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>{children}</dialog>;
}
