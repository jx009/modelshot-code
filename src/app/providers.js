"use client";

import { SessionProvider, getSession } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { RechargeProvider } from "@/components/billing/RechargeProvider";
import { setAssetDeliveryUser } from "@/lib/studio/asset-delivery";
import NavigationFeedback from "@/components/ui/NavigationFeedback";

function SessionRefresh({ onRecovered }) {
  const { data: session, status, update } = useSession();
  const hadSession = useRef(false);
  const recovering = useRef(false);
  const onlineRefresh = useRef({ pending: false, startedAt: null });
  useEffect(() => {
    setAssetDeliveryUser(session?.user?.id);
    return () => setAssetDeliveryUser(null);
  }, [session?.user?.id]);
  useEffect(() => {
    const refresh = () => {
      const state = onlineRefresh.current;
      if (!session?.user?.id || state.pending || (state.startedAt !== null && Date.now() - state.startedAt < 30000)) return;
      state.pending = true;
      state.startedAt = Date.now();
      void Promise.resolve().then(() => update()).catch(() => {}).finally(() => { state.pending = false; });
    };
    window.addEventListener("online", refresh);
    return () => window.removeEventListener("online", refresh);
  }, [session?.user?.id, update]);
  useEffect(() => {
    if (status === "authenticated" && session?.user?.id) { hadSession.current = true; return; }
    if (status !== "unauthenticated" || !hadSession.current) return;
    let active = true, busy = false, attempts = 0;
    const probe = async () => {
      if (!active || busy || recovering.current || attempts >= 4 || document.visibilityState === "hidden") return;
      attempts++;
      busy = true; recovering.current = true;
      try {
        const fresh = await getSession({ broadcast: false });
        if (active && fresh?.user?.id) onRecovered(fresh);
      } catch {
        return;
      } finally {
        busy = false; recovering.current = false;
        if (active && attempts >= 4) { hadSession.current = false; clearInterval(timer); }
      }
    };
    // A transient null response is cached by NextAuth; recover only from a new
    // server-verified session, never from localStorage or a previous balance.
    const timer = setInterval(probe, 4000);
    void probe();
    return () => { active = false; clearInterval(timer); };
  }, [status, session?.user?.id, onRecovered]);
  return null;
}

export function Providers({ children }) {
  const [recovery, setRecovery] = useState(null);
  return (
    <SessionProvider key={recovery?.expires || "initial"} session={recovery || undefined} refetchInterval={60} refetchOnWindowFocus={false} refetchWhenOffline={false}>
      <SessionRefresh onRecovered={setRecovery} />
      <AuthProvider><RechargeProvider><NavigationFeedback>{children}</NavigationFeedback></RechargeProvider></AuthProvider>
    </SessionProvider>
  );
}
