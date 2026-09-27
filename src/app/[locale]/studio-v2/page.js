import StudioWorkbench from "@/components/studio/StudioWorkbench";
export default async function StudioPage({ searchParams }) { const q = await searchParams; return <StudioWorkbench initialDocument={typeof q.document === "string" ? q.document : ""} initialPrompt={typeof q.prompt === "string" ? q.prompt.slice(0, 4000) : ""} initialMode={q.mode === "quick" ? "quick" : "chat"} />; }
