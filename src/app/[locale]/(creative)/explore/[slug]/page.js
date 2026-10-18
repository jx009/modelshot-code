import { notFound } from "next/navigation";
import { getCase } from "@/lib/commerce/catalog";
import { findInspiration } from "@/lib/server/inspiration";
import CaseDetail from "@/components/discover/CaseDetail";
import InspirationDetail from "@/components/discover/InspirationDetail";
export const dynamic = "force-dynamic";
export default async function CasePage({ params }) {
  const { slug } = await params;
  const item = await findInspiration(slug);
  if (item) return <InspirationDetail item={item} />;
  const legacy = getCase(slug);
  if (!legacy) notFound();
  return <CaseDetail item={legacy} />;
}
