import { getPaymentConfig, validateGateway } from "@/lib/domain/billing/recharge-config.js";
import { rechargeReturnPath } from "@/lib/billing-return.js";
export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const cfg = await getPaymentConfig();
  const locale = params.get("locale") === "en" ? "en" : "zh";
  const orderId = params.get("orderId") || params.get("out_trade_no");
  const target = new URL(`${validateGateway(cfg.publicUrl)}${rechargeReturnPath(locale, { orderId })}`);
  // Browser return is never trusted as proof of payment.
  return Response.redirect(target, 303);
}
