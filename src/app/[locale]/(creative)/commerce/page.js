import CommerceStudio from "@/components/commerce/CommerceStudio";
export default async function CommercePage({ searchParams }) {
  const query = await searchParams;
  return <CommerceStudio caseId={typeof query.case === "string" ? query.case : ""} description={typeof query.brief === "string" ? query.brief.slice(0, 2400) : ""} documentId={typeof query.document === "string" ? query.document : ""} homeDraft={typeof query.draft === "string" ? query.draft.slice(0, 80) : ""} />;
}
