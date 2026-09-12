"use client";
import { useRef, useState } from "react";
import { useLocale } from "next-intl";
import Modal from "@/components/ui/Modal";
import { requestKey } from "@/lib/client-api";

export function useAdminReason() {
  const zh = useLocale() === "zh";
  const resolve = useRef(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const ask = () => new Promise(done => { resolve.current = done; setReason(""); setOpen(true); });
  function finish(value) { resolve.current?.(value); resolve.current = null; setOpen(false); }
  const dialog = open && <Modal label={zh ? "操作原因" : "Operation reason"} onClose={() => finish(null)}><form onSubmit={event => { event.preventDefault(); finish({ reason, key: requestKey() }); }}><h2>{zh ? "操作原因" : "Operation reason"}</h2><input aria-label={zh ? "原因" : "Reason"} minLength={3} maxLength={500} required value={reason} onChange={event => setReason(event.target.value)} /><div className="dialog-actions"><button type="button" className="button" onClick={() => finish(null)}>{zh ? "取消" : "Cancel"}</button><button className="button primary">{zh ? "确认" : "Confirm"}</button></div></form></Modal>;
  return { ask, dialog };
}
