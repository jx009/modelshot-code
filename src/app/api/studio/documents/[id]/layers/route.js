import { requireUser } from "@/lib/require-user";
import { errorResponse, AppError } from "@/lib/http";
import { readDocumentPage } from "@/lib/domain/studio/document-read";
export async function GET(request, context) {
  try {
    const user = await requireUser(), { id } = await context.params, query = new URL(request.url).searchParams;
    const version = Number(query.get("version")), offset = Number(query.get("offset"));
    if (!Number.isInteger(version) || version < 1) throw new AppError("INVALID_VERSION");
    const document = await readDocumentPage(user.id, id, offset, version);
    return Response.json({ items: document.content.layers, version: document.version, total: document.layerCount });
  } catch (error) { return errorResponse(error); }
}
