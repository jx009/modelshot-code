import { redirect } from "next/navigation";

export default async function ExploreRedirect({ params, searchParams }) {
  const { locale } = await params;
  const { category } = await searchParams;
  const query = typeof category === "string" ? `?${new URLSearchParams({ category })}` : "";
  redirect(`/${locale}${query}#inspiration`);
}
