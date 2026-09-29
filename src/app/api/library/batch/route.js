import { z } from "zod";
import { requireUser } from "@/lib/require-user";
import { readJson, errorResponse } from "@/lib/http";
import { batchLibraryItems } from "@/lib/domain/assets/library";
const inputSchema = z.object({ ids: z.array(z.string().min(1).max(128)).min(1).max(100), action: z.enum(["trash", "restore", "category"]), categoryId: z.string().max(128).nullable().optional() }).strict().refine(data => data.action !== "category" || data.categoryId !== undefined, "CATEGORY_REQUIRED");
export async function POST(request) {
  try { const user = await requireUser(), data = await readJson(request, inputSchema); return Response.json(await batchLibraryItems(user.id, data.ids, data.action, data.categoryId)); }
  catch (error) { return errorResponse(error); }
}
