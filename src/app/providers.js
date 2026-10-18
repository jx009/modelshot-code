"use client";

import { SessionProvider, getSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { RechargeProvider } from "@/components/billing/RechargeProvider";

function SessionRefresh({ onRecovered }) {
  const { data: session, status, update } = useSession();
  // SessionProvider already refreshes on focus and its interval. Calling update()
  // on every navigation adds a CSRF round trip and temporarily sets loading.
  useEffect(() => {
    const refresh = () => { if (session?.user?.id) void update(); };
    window.addEventListener("online", refresh);
    return () => window.removeEventListener("online", refresh);
  }, [session?.user?.id, update]);
  useEffect(() => {
    if (status !== "unauthenticated") return;
    let active = true, busy = false, attempts = 0;
    const probe = async () => {
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      try {
        const fresh = await getSession({ broadcast: false });
        if (active && fresh?.user?.id) onRecovered(fresh);
      } catch {
        // A failed network probe is retried on focus, reconnect, or the timer.
      } finally { busy = false; }
    };
    // A transient null response is cached by NextAuth; recover only from a new
    // server-verified session, never from localStorage or a previous balance.
    const timer = setInterval(() => { if (++attempts <= 3) void probe(); else clearInterval(timer); }, 4000);
    window.addEventListener("online", probe);
    window.addEventListener("focus", probe);
    void probe();
    return () => { active = false; clearInterval(timer); window.removeEventListener("online", probe); window.removeEventListener("focus", probe); };
  }, [status, onRecovered]);
  return null;
}

export function Providers({ children }) {
  const [recovery, setRecovery] = useState(null);
  return (
    <SessionProvider key={recovery?.expires || "initial"} session={recovery || undefined} refetchInterval={60} refetchOnWindowFocus refetchWhenOffline={false}>
      <SessionRefresh onRecovered={setRecovery} />
      <AuthProvider><RechargeProvider>{children}</RechargeProvider></AuthProvider>
    </SessionProvider>
  );
}
