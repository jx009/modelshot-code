"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import CommerceStudio from "@/components/commerce/CommerceStudio";

export default function CommercePage() {
  const query = useSearchParams();
  const [initial] = useState(() => ({ caseId: query.get("case") || "", description: (query.get("brief") || "").slice(0, 2400), documentId: query.get("document") || "", homeDraft: (query.get("draft") || "").slice(0, 80) }));
  return <CommerceStudio {...initial} />;
}
