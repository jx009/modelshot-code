import { currentAnnouncement } from "@/lib/server/announcements";
import { errorResponse } from "@/lib/http";
export async function GET() {
  try { return Response.json({ announcement: await currentAnnouncement() }, { headers: { "Cache-Control": "no-store" } }); }
  catch (e) { return errorResponse(e); }
}
