import { z } from "zod";
import { prisma } from "../../../lib/prisma.js";
import { requireUser } from "../../../lib/require-user.js";
import { errorResponse, readJson } from "../../../lib/http.js";
import { createExport, EXPORT_LIMITS } from "../../../lib/domain/generation/exports.js";

export async function GET() {
  try {
    const user = await requireUser();
    return Response.json(await prisma.exportJob.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 30 }));
  } catch (error) { return errorResponse(error); }
}
export async function POST(request) {
  try {
    const user = await requireUser();
    const input = await readJson(request, z.object({ outputIds: z.array(z.string().max(128)).min(1).max(EXPORT_LIMITS.outputs), mode: z.enum(["original", "delivery"]).default("delivery") }).strict());
    return Response.json(await createExport(user.id, input.outputIds, input.mode, request.headers.get("idempotency-key")), { status: 202 });
  } catch (error) { return errorResponse(error); }
}
