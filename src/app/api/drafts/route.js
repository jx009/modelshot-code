import { prisma } from "../../../lib/prisma.js";
import { requireUser } from "../../../lib/require-user.js";
import { AppError, errorResponse, readJson, sameOrigin } from "../../../lib/http.js";
import { draftSchema, saveDraft } from "../../../lib/domain/generation/drafts.js";

export async function GET(request) {
  try {
    const user = await requireUser();
    const id = new URL(request.url).searchParams.get("id");
    if (id) {
      const draft = await prisma.draft.findFirst({ where: { id, userId: user.id } });
      if (!draft) throw new AppError("DRAFT_NOT_FOUND", 404);
      return Response.json(draft);
    }
    return Response.json(await prisma.draft.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" }, take: 50, select: { id: true, name: true, projectId: true, version: true, updatedAt: true } }));
  } catch (error) { return errorResponse(error); }
}
export async function POST(request) {
  try {
    const user = await requireUser();
    return Response.json(await saveDraft(user.id, await readJson(request, draftSchema)));
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request) {
  try {
    sameOrigin(request);
    const user = await requireUser();
    const id = new URL(request.url).searchParams.get("id");
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
      if (!id || !await tx.draft.findFirst({ where: { id, userId: user.id } })) throw new AppError("DRAFT_NOT_FOUND", 404);
      await tx.assetReference.deleteMany({ where: { entityId: id, kind: "draft" } });
      await tx.draft.delete({ where: { id } });
    });
    return Response.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
