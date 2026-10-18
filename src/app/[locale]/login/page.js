import { redirect } from "next/navigation";
import { authDestination } from "@/lib/auth-navigation";

// Compatibility for old bookmarks, invitation links and NextAuth callbacks.
// There is deliberately no standalone login UI.
export default async function Login({ params, searchParams }) {
  const { locale } = await params;
  const search = await searchParams;
  const query = new URLSearchParams({ auth: "login" });
  const callback = search.callbackUrl || search.next;
  if (typeof callback === "string") query.set("callbackUrl", authDestination(callback, locale));
  for (const key of ["ref", "error"]) if (typeof search[key] === "string") query.set(key, search[key]);
  redirect(`/${locale}?${query}`);
}
