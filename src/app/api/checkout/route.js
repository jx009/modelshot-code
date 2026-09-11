import { z } from "zod";
import { requireUser } from "../../../lib/require-user.js";
import { AppError, errorResponse, readJson } from "../../../lib/http.js";
import { getStripe } from "../../../lib/stripe.js";
import { startCheckout } from "../../../lib/domain/billing/payments.js";

export async function POST(request) {
  try {
    if (process.env.PAYMENTS_ENABLED !== "1") throw new AppError("CHECKOUT_UNAVAILABLE", 503);
    const user = await requireUser();
    const { planId } = await readJson(request, z.object({ planId: z.string().max(40) }).strict());
    return Response.json(await startCheckout(user.id, planId, request.headers.get("idempotency-key"), await getStripe()));
  } catch (error) { return errorResponse(error); }
}
