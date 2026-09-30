import { redirect } from "next/navigation";

/** 旧图库由项目历史取代，保留路由仅用于兼容旧链接。 */
export default async function LegacyGalleryRedirect({ params }) {
  const { locale } = await params;
  redirect(`/${locale}/projects`);
}
