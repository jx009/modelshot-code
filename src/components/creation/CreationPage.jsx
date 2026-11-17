"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { useSession } from "next-auth/react";
import { useAuth } from "@/components/auth/AuthProvider";
import Link from "@/components/ui/NavigationLink";
import GuestGate from "@/components/ui/GuestGate";
import CreationWorkspace from "./CreationWorkspace";
import CreationStart from "./CreationStart";
import "./creation.css";
import "./workspace-density.css";
import "./workbench.css";
import BrandLoader from "@/components/ui/BrandLoader";

function Page() {
  const query = useSearchParams(), zh = useLocale() === "zh", auth = useAuth(), { data: session, status } = useSession();
  const projectId = query.get("project");
  if (status === "loading") return <BrandLoader label={zh ? "正在打开创作工作台" : "Opening creation workspace"} />;
  if (!session?.user?.id) return <GuestGate images={["architecture-blueprint.052952081a77", "city-type.7ee734b9761d", "soft-sound.11d715efd90b"]}
    title={zh ? "输入主题，一键生成 PPT" : "Type a topic, get a deck"} description={zh ? "自动规划大纲、版式和配图，生成后可逐页编辑并导出 PPTX。" : "Outline, layout and visuals are planned for you. Edit page by page and export to PPTX."}
    action={zh ? "登录后打开创作项目" : "Sign in to open your project"} onAction={() => auth.open()} />;
  if (!projectId) return <CreationStart key={session.user.id} userId={session.user.id} zh={zh} />;
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(projectId)) return <div className="cw-loading"><Link href="/creation">{zh ? "项目链接无效，新建 PPT" : "Invalid project link. Start a new deck"}</Link></div>;
  return <CreationWorkspace key={`${session.user.id}:${projectId}:${query.get("session") || ""}`} userId={session.user.id} projectId={projectId}
    initialSessionId={query.get("session")} initialFileId={query.get("file")} zh={zh} />;
}
export default function CreationPage() {
  return <Suspense fallback={<BrandLoader label="正在打开创作工作台" />}><Page /></Suspense>;
}
