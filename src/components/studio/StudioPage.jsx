"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import StudioWorkbench from "./StudioWorkbench";
import { IMAGE_SIZES } from "@/lib/studio/image-size";

export default function StudioPage() {
  const query = useSearchParams();
  const [initial] = useState(() => ({
    initialSize: IMAGE_SIZES.includes(query.get("size")) ? query.get("size") : "1024x1024",
    initialCount: ["1", "2", "3", "4"].includes(query.get("count")) ? Number(query.get("count")) : 1,
    initialFixed: (query.get("fixed") || "").slice(0, 1600),
    initialDocument: query.get("document") || "",
    initialPrompt: (query.get("prompt") || "").slice(0, 4000),
    initialProvider: (query.get("provider") || "").slice(0, 128),
    initialMode: query.get("mode") === "quick" ? "quick" : "chat",
  }));
  return <StudioWorkbench {...initial} />;
}
