import { getCreditPackages, getPaymentConfig, localizePackage, paymentMethods } from "../../../lib/domain/billing/recharge-config.js";
import { errorResponse } from "../../../lib/http.js";
export async function GET(request) {
  try {
    const locale = new URL(request.url).searchParams.get("locale") === "en" ? "en" : "zh";
    const [rows, cfg] = await Promise.all([getCreditPackages(), getPaymentConfig()]);
    const methods = paymentMethods(cfg, locale === "zh" ? "cny" : "usd");
    return Response.json({ version: "dynamic-credits-v1", products: rows.filter(row => row.active).sort((a, b) => a.sort - b.sort).map(row => localizePackage(row, locale)),
      paymentsEnabled: methods.length > 0, methods }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
