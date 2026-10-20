import { redirect } from "next/navigation";

export default async function InvitePage({ params }) {
  const { locale } = await params;
  redirect(`/${locale}?panel=invite`);
}
