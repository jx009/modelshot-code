import { redirect } from "next/navigation";

// Old bookmarks and payment callbacks open records on the homepage.
// The retired account/subscription dashboard is no longer rendered.
export default async function AccountPage({ params, searchParams }) {
  const { locale } = await params;
  const search = await searchParams;
  const query = new URLSearchParams({ records: search.tab === "usage" ? "usage" : "orders" });
  redirect(`/${locale}?${query}`);
}
