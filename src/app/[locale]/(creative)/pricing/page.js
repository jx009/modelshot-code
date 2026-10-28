import { redirect } from "next/navigation";
import { rechargeReturnPath } from "@/lib/billing-return";

export default async function RetiredPricingPage({ params, searchParams }) {
  const { locale } = await params;
  redirect(rechargeReturnPath(locale, await searchParams));
}
