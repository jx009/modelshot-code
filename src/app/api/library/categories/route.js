import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/require-user";
import { errorResponse, readJson } from "@/lib/http";
export async function GET() {
  try {
    const user = await requireUser();
    return Response.json(await prisma.libraryCategory.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" }, include: { _count: { select: { items: { where: { deletedAt: null } } } } } }));
  } catch (error) { return errorResponse(error); }
}
export async function POST(request) {
  try {
    const user = await requireUser(), input = await readJson(request, z.object({ name: z.string().trim().min(1).max(10) }).strict());
    return Response.json(await prisma.libraryCategory.upsert({ where: { userId_name: { userId: user.id, name: input.name } }, create: { userId: user.id, name: input.name }, update: {} }));
  } catch (error) { return errorResponse(error); }
}
