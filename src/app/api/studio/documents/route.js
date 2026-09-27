import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/require-user";
import { errorResponse, readJson } from "@/lib/http";
import { documentSchema } from "@/lib/studio/tools";
import { saveDocument } from "@/lib/domain/studio/documents";
export async function GET() {
  try { const user = await requireUser(); const rows = await prisma.studioDocument.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" }, take: 100, select: { id: true, name: true, version: true, updatedAt: true, content: true } }); return Response.json(rows.map(({ content, ...row }) => ({ ...row, kind: content.commerce ? "commerce" : "canvas", coverAssetId: content.commerce?.productAssetId || content.layers.find(l => l.type === "image")?.assetId || null, count: content.commerce?.sections.length || content.layers.length }))); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request) {
  try { const user = await requireUser(); return Response.json(await saveDocument(user.id, await readJson(request, documentSchema, 524288))); }
  catch (error) { return errorResponse(error); }
}
