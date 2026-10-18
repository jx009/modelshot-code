import { prisma } from "@/lib/prisma.js";
import { requireUser } from "@/lib/require-user.js";
import { AppError, errorResponse } from "@/lib/http.js";
export async function GET(request) {
  try {
    const user = await requireUser();
    const id = new URL(request.url).searchParams.get("orderId");
    if (!id || id.length > 80) throw new AppError("INVALID_INPUT");
    const order = await prisma.order.findFirst({ where: { id, userId: user.id }, select: { id: true, status: true, amountMinor: true, currency: true, metadata: true } });
    if (!order) throw new AppError("ORDER_NOT_FOUND", 404);
    const snapshot = JSON.parse(order.metadata || "{}");
    return Response.json({ id: order.id, status: order.status, amountMinor: order.amountMinor, currency: order.currency, credits: snapshot.credits || 0 }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
