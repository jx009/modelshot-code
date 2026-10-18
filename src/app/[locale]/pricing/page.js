"use client";
import ContentShell from "@/components/ContentShell";
import RechargePanel from "@/components/billing/RechargePanel";
export default function PricingPage() {
  return <ContentShell className="px-3 sm:px-6 py-8 sm:py-14"><div className="w-full max-w-[1060px] mx-auto rounded-xl border border-divider overflow-hidden"><RechargePanel /></div></ContentShell>;
}
