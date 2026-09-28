import { requireUser } from "@/lib/require-user";
import { errorResponse } from "@/lib/http";
import { capabilities, studioConfig } from "@/lib/domain/studio/providers";
export async function GET(request) {
  try {
    await requireUser();
    const query = new URL(request.url).searchParams;
    const config = await studioConfig(undefined, query.get("imageProvider") || undefined);
    return Response.json(await capabilities(undefined, config));
  }
  catch (error) { return errorResponse(error); }
}
