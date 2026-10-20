import { getAnnouncements } from "@/lib/server/announcements";
import { selectAnnouncement } from "@/lib/announcements";
import { announcementQrUrl } from "@/lib/server/announcement-qr";
import { AppError, errorResponse } from "@/lib/http";

export async function GET(request) {
  try {
    const item = selectAnnouncement((await getAnnouncements()).items);
    if (!item || item.id !== new URL(request.url).searchParams.get("id") || item.buttonAction !== "qr") throw new AppError("ANNOUNCEMENT_UNAVAILABLE", 404);
    return Response.json(await announcementQrUrl(item.qrImage), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
