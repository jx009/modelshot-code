"use client";
import { createContext, Suspense, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import Modal from "@/components/ui/Modal";
import { authDestination } from "@/lib/auth-navigation";
import AuthPanel from "./AuthPanel";
import styles from "./auth.module.css";

const AuthContext = createContext(null);
export function useAuth() { return useContext(AuthContext); }

function AuthRouteEntry({ open }) {
  const params = useSearchParams();
  const path = usePathname();
  const handled = useRef(null);
  const query = params.toString();
  useEffect(() => {
    const search = new URLSearchParams(query);
    if (search.get("auth") !== "login") { handled.current = null; return; }
    const key = `${path}?${query}`;
    if (handled.current === key) return;
    handled.current = key;
    open({ callbackUrl: search.get("callbackUrl"), refCode: search.get("ref"), error: search.get("error") });
  }, [path, query, open]);
  return null;
}

function withoutAuthQuery(url) {
  for (const key of ["auth", "callbackUrl", "ref", "error"]) url.searchParams.delete(key);
  return `${url.pathname}${url.search}${url.hash}`;
}

function clearAuthQuery() {
  const url = new URL(window.location.href);
  if (url.searchParams.get("auth") !== "login") return;
  window.history.replaceState(window.history.state, "", withoutAuthQuery(url));
}

export function AuthProvider({ children }) {
  const [request, setRequest] = useState(null);
  const locale = useLocale();
  const router = useRouter();
  const open = useCallback((options = {}) => setRequest(options), []);
  const close = useCallback(() => { setRequest(null); clearAuthQuery(); }, []);
  const complete = useCallback(() => {
    const destination = request?.callbackUrl ? authDestination(request.callbackUrl, locale) : null;
    const current = new URL(window.location.href);
    setRequest(null);
    // Navigate through the router when completing a legacy entry. A refresh
    // immediately after replaceState can restore the previous server URL.
    if (current.searchParams.get("auth") === "login") router.replace(destination || withoutAuthQuery(current));
    else if (destination && destination !== `${current.pathname}${current.search}${current.hash}`) router.push(destination);
    else router.refresh();
  }, [request, locale, router]);
  return <AuthContext.Provider value={{ open, close }}>{children}
    <Suspense fallback={null}><AuthRouteEntry open={open} /></Suspense>
    {request && <Modal onClose={close} label={locale === "zh" ? "登录来塔绘梦" : "Sign in to 来塔绘梦"} className={styles.dialog}>
      <AuthPanel request={request} onClose={close} onSuccess={complete} />
    </Modal>}
  </AuthContext.Provider>;
}
