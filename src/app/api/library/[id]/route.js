import { z } from "zod";
import { requireUser } from "@/lib/require-user";
import { errorResponse, readJson } from "@/lib/http";
import { updateLibraryItem } from "@/lib/domain/assets/library";
export async function PATCH(request, context) {
  try {
    const user = await requireUser(), { id } = await context.params;
    const input = await readJson(request, z.object({ name: z.string().trim().min(1).max(160).optional(), categoryId: z.string().max(128).nullable().optional(), trash: z.literal(true).optional(), restore: z.literal(true).optional() }).strict().refine(value => !(value.trash && value.restore)));
    return Response.json(await updateLibraryItem(user.id, id, input));
  } catch (error) { return errorResponse(error); }
}
