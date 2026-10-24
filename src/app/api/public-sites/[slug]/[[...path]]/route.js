import { clientAddress, errorResponse } from "@/lib/http";
import { rateLimit } from "@/lib/domain/identity/rate-limit";
import { isConfiguredPublicationHost, publicWebHeaders, readPublishedWebResource } from "@/lib/domain/creation/web-publications";

export async function GET(request, context) {
  try {
    if (!isConfiguredPublicationHost(request)) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
    await rateLimit("creation-public-site", clientAddress(request), 120, 60);
    const { slug, path = [] } = await context.params;
    const resource = await readPublishedWebResource(slug, path.join("/"));
    return new Response(resource.body, { headers: publicWebHeaders(resource.contentType) });
  } catch (error) { return errorResponse(error); }
}
