import { clientAddress, errorResponse } from "@/lib/http";
import { rateLimit } from "@/lib/domain/identity/rate-limit";
import { isConfiguredPublicationHost, publicWebHeaders, readPublishedWebResource } from "@/lib/domain/creation/web-publications";

export async function GET(request, context) {
  try {
    if (!isConfiguredPublicationHost(request)) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
    await rateLimit("creation-public-site", clientAddress(request), 120, 60);
    const { slug, path = [] } = await context.params;
    let revision, resourcePath = path;
    if (path[0] === "~v") {
      if (!/^[1-9][0-9]{0,14}$/.test(path[1] || "")) return new Response(null, { status: 404 });
      revision = Number(path[1]); resourcePath = path.slice(2);
    }
    const resource = await readPublishedWebResource(slug, resourcePath.join("/"), revision);
    if (resource.redirect) return new Response(null, { status: 307, headers: { Location: resource.redirect, "Cache-Control": "no-store" } });
    return new Response(resource.body, { headers: publicWebHeaders(resource.contentType) });
  } catch (error) { return errorResponse(error); }
}
