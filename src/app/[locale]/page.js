import { redirect } from "next/navigation";
import { routing } from "@/i18n/routing";

export default async function HomePage({ params }) {
  const { locale } = await params;
  redirect(`/${routing.locales.includes(locale) ? locale : routing.defaultLocale}/studio`);
}
