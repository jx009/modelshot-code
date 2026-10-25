import { isConfiguredPublicationHost, publicationOrigin } from "@/lib/domain/creation/web-publications";
import { webRuntimeShell, webRuntimeHeaders } from "@/lib/creation/web-runtime";

export async function GET(request) {
  try {
    if (!isConfiguredPublicationHost(request) || !process.env.NEXTAUTH_URL) return new Response(null, { status: 404 });
    const appOrigin = new URL(process.env.NEXTAUTH_URL).origin;
    publicationOrigin();
    return new Response(webRuntimeShell(appOrigin), { headers: webRuntimeHeaders(appOrigin) });
  } catch { return new Response(null, { status: 404 }); }
}
