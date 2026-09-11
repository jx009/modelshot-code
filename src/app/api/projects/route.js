import { z } from "zod";
import { prisma } from "../../../lib/prisma.js";
import { requireUser } from "../../../lib/require-user.js";
import { AppError, errorResponse, readJson } from "../../../lib/http.js";

export async function GET() {
  try {
    const user = await requireUser();
    return Response.json(await prisma.project.findMany({ where: { userId: user.id, archivedAt: null }, orderBy: { updatedAt: "desc" }, take: 100 }));
  } catch (error) { return errorResponse(error); }
}
export async function POST(request) {
  try {
    const user = await requireUser();
    const data = await readJson(request, z.object({ name: z.string().trim().min(1).max(100), sku: z.string().max(80).default("") }).strict());
    return Response.json(await prisma.project.create({ data: { ...data, userId: user.id } }));
  } catch (error) { return errorResponse(error); }
}
export async function PATCH(request) {
  try {
    const user = await requireUser();
    const { id, name, sku, archived } = await readJson(request, z.object({ id: z.string().max(128), name: z.string().trim().min(1).max(100).optional(), sku: z.string().max(80).optional(), archived: z.boolean().optional() }).strict());
    const updated = await prisma.project.updateMany({ where: { id, userId: user.id }, data: { name, sku, ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}) } });
    if (!updated.count) throw new AppError("PROJECT_NOT_FOUND", 404);
    return Response.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
