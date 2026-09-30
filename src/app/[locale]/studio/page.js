import { redirect } from "next/navigation";

/** V1 的电商试衣工作台已由项目画布取代。 */
export default async function LegacyStudioRedirect({ params, searchParams }) {
  const { locale } = await params;
  const query = await searchParams;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query || {})) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item != null) search.append(key, item);
    }
  }
  redirect(`/${locale}/studio-v2${search.toString() ? `?${search}` : ""}`);
}
