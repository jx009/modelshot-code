"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { ResilientSessionProvider } from "@/components/auth/ResilientSessionProvider";
import { RechargeProvider } from "@/components/billing/RechargeProvider";
import { setAssetDeliveryUser } from "@/lib/studio/asset-delivery";
import NavigationFeedback from "@/components/ui/NavigationFeedback";
import { setImageCapabilitiesUser } from "@/lib/studio/image-capabilities-client";

function SessionBindings() {
  const { data: session } = useSession();
  useEffect(() => {
    setAssetDeliveryUser(session?.user?.id);
    setImageCapabilitiesUser(session?.user?.id);
    return () => { setAssetDeliveryUser(null); setImageCapabilitiesUser(null); };
  }, [session?.user?.id]);
  return null;
}

export function Providers({ children }) {
  return (
    <ResilientSessionProvider>
      <SessionBindings />
      <AuthProvider><RechargeProvider><NavigationFeedback>{children}</NavigationFeedback></RechargeProvider></AuthProvider>
    </ResilientSessionProvider>
  );
}
