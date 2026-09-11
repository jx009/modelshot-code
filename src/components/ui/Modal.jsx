"use client";
import { useEffect, useRef } from "react";

export default function Modal({ children, onClose, label, className = "workflow-dialog" }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    const focused = document.activeElement;
    dialog.showModal();
    return () => { dialog.close(); if (focused?.isConnected) focused.focus(); };
  }, []);
  return <dialog ref={ref} className={className} aria-label={label} onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>{children}</dialog>;
}
