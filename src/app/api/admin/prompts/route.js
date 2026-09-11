import { z } from "zod";
import { prisma } from "../../../../lib/prisma.js";
import { requireAdmin } from "../../../../lib/admin-auth.js";
import { readJson, errorResponse, AppError } from "../../../../lib/http.js";
import { invalidatePromptCache } from "../../../../lib/prompt-template-store.js";

export async function GET(request) {
  try { const auth = await requireAdmin(request); if (auth.response) return auth.response; return Response.json(await prisma.promptTemplate.findMany({ orderBy: [{ isActive: "desc" }, { category: "asc" }] })); }
  catch (error) { return errorResponse(error); }
}
const schema = z.object({ id: z.string().max(128).optional(), name: z.string().min(1).max(100).optional(), category: z.enum(["top", "bottom", "dress", "outerwear", "swimwear"]).optional(), template: z.string().min(1).max(8000).optional(), isActive: z.boolean().optional() }).strict();
async function write(request, create) {
  try {
    const auth = await requireAdmin(request); if (auth.response) return auth.response;
    const { id, ...data } = await readJson(request, schema);
    if (create ? !data.name || !data.category || !data.template : !id) throw new AppError("INVALID_INPUT");
    const row = await prisma.$transaction(async tx => {
      const before = create ? null : await tx.promptTemplate.findUnique({ where: { id } });
      const updated = create ? await tx.promptTemplate.create({ data }) : await tx.promptTemplate.update({ where: { id }, data });
      await tx.adminAuditLog.create({ data: { adminId: auth.user.id, action: create ? "CREATE_TEMPLATE" : "UPDATE_TEMPLATE", detail: JSON.stringify({ id: updated.id, beforeVersion: before?.updatedAt, fields: Object.keys(data) }) } });
      return updated;
    });
    invalidatePromptCache(); return Response.json(row);
  } catch (error) { return errorResponse(error); }
}
export const POST = request => write(request, true);
export const PATCH = request => write(request, false);
