import { notFound } from "next/navigation";
import { CASES, getCase } from "@/lib/commerce/catalog";
import CaseDetail from "@/components/discover/CaseDetail";
export function generateStaticParams() { return CASES.map(item => ({ slug: item.id })); }
export default async function CasePage({ params }) { const { slug } = await params; const item = getCase(slug); if (!item) notFound(); return <CaseDetail item={item} />; }
