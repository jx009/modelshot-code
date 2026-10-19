import { notFound } from "next/navigation";
import { getCase } from "@/lib/commerce/catalog";
import { findInspiration } from "@/lib/server/inspiration";
import CaseDetail from "@/components/discover/CaseDetail";
import InspirationDetail from "@/components/discover/InspirationDetail";
import { after } from "next/server";
import { publicInspirationGallery } from "@/lib/server/inspiration";
import { enqueueInspirationGallery, inspirationDelivery } from "@/lib/server/inspiration-delivery";
export const dynamic = "force-dynamic";
export default async function CasePage({ params }) {
  const { slug } = await params;
  const item = await findInspiration(slug);
  if (item) {
    after(async () => enqueueInspirationGallery(await publicInspirationGallery()));
    const delivered = await inspirationDelivery({ items: [item] });
    return <InspirationDetail item={delivered.items[0]} />;
  }
  const legacy = getCase(slug);
  if (!legacy) notFound();
  return <CaseDetail item={legacy} />;
}
