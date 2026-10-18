import { fulfillEpay } from "@/lib/domain/billing/epay.js";
import { readBytes } from "@/lib/http.js";

async function callback(request) {
  try {
    const values = request.method === "POST" ? new URLSearchParams((await readBytes(request, 16_384)).toString("utf8")) : new URL(request.url).searchParams;
    const params = {};
    for (const [key, value] of values) {
      if (key in params || key.length > 80 || value.length > 2048) return new Response("fail", { status: 400 });
      params[key] = value;
    }
    await fulfillEpay(params);
    return new Response("success", { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[EPAY_CALLBACK]", error.code || "PAYMENT_FAILED");
    return new Response("fail", { status: error.status || 500, headers: { "Cache-Control": "no-store" } });
  }
}
export { callback as GET, callback as POST };
