import { getStripe } from "../../../../lib/stripe.js";
import { getSiteConfig } from "../../../../lib/site-config.js";
import { AppError, errorResponse, readBytes } from "../../../../lib/http.js";
import { acceptPaymentEvent } from "../../../../lib/domain/billing/payments.js";

export async function POST(request) {
  try {
    const secret = await getSiteConfig("stripe_webhook_secret");
    if (!secret) throw new AppError("WEBHOOK_UNAVAILABLE", 503);
    const body = await readBytes(request, 1024 * 1024);
    const signature = request.headers.get("stripe-signature");
    const stripe = await getStripe();
    let event;
    try { event = stripe.webhooks.constructEvent(body, signature, secret); }
    catch { throw new AppError("INVALID_WEBHOOK_SIGNATURE", 400); }
    return Response.json(await acceptPaymentEvent(event));
  } catch (error) { return errorResponse(error); }
}
