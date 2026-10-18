import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { readJson, errorResponse } from "@/lib/http";
import { announcementsSchema } from "@/lib/announcements";
import { getAnnouncements, saveAnnouncements } from "@/lib/server/announcements";
import { auditedOperation } from "@/lib/domain/identity/admin-operation";
export async function GET(req) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;
  try { return Response.json(await getAnnouncements(), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (e) { return errorResponse(e); }
}
export async function PATCH(req) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;
  try {
    const input = await readJson(req, z.object({ items: announcementsSchema, version: z.string().regex(/^[a-f0-9]{64}$/), reason: z.string().trim().min(3).max(500) }).strict(), 100_000);
    return Response.json(await auditedOperation(auth.user.id, req.headers.get("idempotency-key"), "UPDATE_ANNOUNCEMENTS", input,
      tx => saveAnnouncements(tx, input.items, input.version)));
  } catch (e) { return errorResponse(e); }
}
