import { z } from "zod";
import { prisma } from "../../../../lib/prisma.js";
import { requireAdmin } from "../../../../lib/admin-auth.js";
import { readJson, errorResponse, sameOrigin, AppError } from "../../../../lib/http.js";
import { readPreset } from "../../../../lib/domain/assets/service.js";

const schema = z.object({ type: z.enum(["models", "scenes"]), id: z.string().max(128).optional(), name: z.string().min(1).max(100).optional(), nameEn: z.string().max(100).optional(), gender: z.string().max(30).optional(), ethnicity: z.string().max(50).optional(), bodyType: z.string().max(50).optional(), category: z.string().max(50).optional(), promptSnippet: z.string().max(4000).optional(), referenceImage: z.string().max(256).nullable().optional(), sortOrder: z.number().int().min(0).max(10000).optional(), isActive: z.boolean().optional() }).strict();
export async function GET(request) {
  try { const auth = await requireAdmin(request); if (auth.response) return auth.response; const model = new URL(request.url).searchParams.get("type") === "scenes" ? prisma.scenePreset : prisma.modelPreset; return Response.json(await model.findMany({ orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }] })); }
  catch (error) { return errorResponse(error); }
}
async function write(request, create) {
  try {
    const auth = await requireAdmin(request); if (auth.response) return auth.response;
    const { type, id, ...input } = await readJson(request, schema);
    if (!create && !id) throw new AppError("INVALID_INPUT");
    const fields = type === "scenes" ? ["name", "nameEn", "category", "promptSnippet", "referenceImage", "sortOrder", "isActive"] : ["name", "nameEn", "gender", "ethnicity", "bodyType", "referenceImage", "sortOrder", "isActive"];
    const data = Object.fromEntries(Object.entries(input).filter(([key]) => fields.includes(key)));
    if (create && (!data.name || (type === "models" ? !data.gender || !data.ethnicity : !data.category))) throw new AppError("INVALID_INPUT");
    const result = await prisma.$transaction(async tx => {
      const model = type === "scenes" ? tx.scenePreset : tx.modelPreset;
      const old = create ? null : await model.findUnique({ where: { id } });
      const reference = data.referenceImage === undefined ? old?.referenceImage : data.referenceImage;
      if ((data.isActive ?? old?.isActive ?? true) && (type === "models" || reference)) { if (!reference) throw new AppError("PRESET_IMAGE_REQUIRED"); await readPreset(reference); }
      const row = create ? await model.create({ data }) : await model.update({ where: { id }, data });
      await tx.adminAuditLog.create({ data: { adminId: auth.user.id, action: create ? "CREATE_PRESET" : "UPDATE_PRESET", detail: JSON.stringify({ id: row.id, type, fields: Object.keys(data), wasActive: old?.isActive }) } });
      return row;
    });
    return Response.json(result);
  } catch (error) { return errorResponse(error); }
}
export const POST = request => write(request, true);
export const PATCH = request => write(request, false);
export async function DELETE(request) {
  try {
    sameOrigin(request); const auth = await requireAdmin(request); if (auth.response) return auth.response;
    const query = new URL(request.url).searchParams, id = query.get("id"), type = query.get("type");
    if (!id || !["models", "scenes"].includes(type)) throw new AppError("INVALID_INPUT");
    await prisma.$transaction(async tx => { await (type === "scenes" ? tx.scenePreset : tx.modelPreset).update({ where: { id }, data: { isActive: false } }); await tx.adminAuditLog.create({ data: { adminId: auth.user.id, action: "ARCHIVE_PRESET", detail: JSON.stringify({ id, type }) } }); });
    return Response.json({ success: true });
  } catch (error) { return errorResponse(error); }
}
