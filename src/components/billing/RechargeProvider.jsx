"use client";
import { createContext, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import Modal from "@/components/ui/Modal";
import { useAuth } from "@/components/auth/AuthProvider";
import dynamic from "next/dynamic";
import styles from "./recharge.module.css";

const RechargeContext = createContext(null);
const AccountRecords = dynamic(() => import("@/components/AccountRecords"));
const RechargePanel = dynamic(() => import("./RechargePanel"));
const InviteCenter = dynamic(() => import("@/components/InviteCenter"));
export function useRecharge() { return useContext(RechargeContext); }

function RecordsRouteEntry({ openRecords, openInvite }) {
  const params = useSearchParams(), path = usePathname();
  const requested = params.get("panel") === "invite" ? "invite" : params.get("records"), handled = useRef(null);
  useEffect(() => {
    if (!["usage", "orders", "invite"].includes(requested)) { handled.current = null; return; }
    const key = `${path}:${requested}`;
    if (handled.current === key) return;
    handled.current = key;
    if (requested === "invite") openInvite();
    else openRecords(requested);
  }, [requested, path, openRecords, openInvite]);
  return null;
}

export function RechargeProvider({ children }) {
  const [view, setView] = useState(null);
  const activeView = useRef(null), returnFocusRef = useRef(null);
  const locale = useLocale(), auth = useAuth();
  const show = useCallback((next, focusRef) => {
    if (!activeView.current) returnFocusRef.current = focusRef?.current || document.activeElement;
    activeView.current = next;
    setView(next);
  }, []);
  const open = useCallback(focusRef => show("recharge", focusRef), [show]);
  const openRecords = useCallback((tab = "orders", focusRef) => show(tab === "usage" ? "usage" : "orders", focusRef), [show]);
  const openInvite = useCallback(focusRef => show("invite", focusRef), [show]);
  const close = useCallback(() => {
    activeView.current = null;
    setView(null);
    const url = new URL(window.location.href);
    if (url.searchParams.has("records") || url.searchParams.get("panel") === "invite") {
      url.searchParams.delete("records");
      if (url.searchParams.get("panel") === "invite") url.searchParams.delete("panel");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, []);
  function signIn(tab) {
    const url = new URL(window.location.href);
    url.searchParams.set("records", tab);
    close();
    auth.open({ callbackUrl: `${url.pathname}${url.search}${url.hash}` });
  }
  const value = useMemo(() => ({ open, close, openRecords, openInvite }), [open, close, openRecords, openInvite]);
  return <RechargeContext.Provider value={value}>
    {children}
    <Suspense fallback={null}><RecordsRouteEntry openRecords={openRecords} openInvite={openInvite} /></Suspense>
    {view === "recharge" && <Modal onClose={close} returnFocusRef={returnFocusRef} label={locale === "zh" ? "积分充值" : "Buy credits"} className={styles.dialog}>
      <RechargePanel onClose={close} onRecords={() => openRecords("orders")} />
    </Modal>}
    {(view === "usage" || view === "orders") && <AccountRecords key={view} initialTab={view} onClose={close} onRecharge={open} onSignIn={signIn} returnFocusRef={returnFocusRef} />}
    {view === "invite" && <InviteCenter onClose={close} returnFocusRef={returnFocusRef} />}
  </RechargeContext.Provider>;
}
