import { getPaymentConfig, validateGateway } from "@/lib/domain/billing/recharge-config.js";
export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const cfg = await getPaymentConfig();
  const locale = params.get("locale") === "en" ? "en" : "zh";
  const target = new URL(`${validateGateway(cfg.publicUrl)}/${locale}/pricing`);
  const orderId = params.get("orderId") || params.get("out_trade_no");
  if (orderId && /^[a-zA-Z0-9_-]{1,80}$/.test(orderId)) target.searchParams.set("orderId", orderId);
  // Browser return is never trusted as proof of payment.
  return Response.redirect(target, 303);
}
