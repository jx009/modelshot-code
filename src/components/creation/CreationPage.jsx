"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { useSession } from "next-auth/react";
import { useAuth } from "@/components/auth/AuthProvider";
import Link from "@/components/ui/NavigationLink";
import CreationWorkspace from "./CreationWorkspace";
import "./creation.css";
import "./workspace-density.css";

function Page() {
  const query = useSearchParams(), zh = useLocale() === "zh", auth = useAuth(), { data: session, status } = useSession();
  const projectId = query.get("project");
  if (status === "loading") return <div className="cw-loading" role="status">{zh ? "正在打开创作工作台…" : "Opening creation workspace…"}</div>;
  if (!session?.user?.id) return <div className="cw-loading"><button onClick={() => auth.open()}>{zh ? "登录后打开创作项目" : "Sign in to open your project"}</button></div>;
  if (!projectId || !/^[a-zA-Z0-9_-]{1,128}$/.test(projectId)) return <div className="cw-loading"><Link href="/">{zh ? "返回首页开始创作" : "Return home to start creating"}</Link></div>;
  return <CreationWorkspace key={`${session.user.id}:${projectId}:${query.get("session") || ""}`} userId={session.user.id} projectId={projectId}
    initialSessionId={query.get("session")} initialFileId={query.get("file")} zh={zh} />;
}
export default function CreationPage() {
  return <Suspense fallback={<div className="cw-loading" role="status">正在打开创作工作台… / Opening workspace…</div>}><Page /></Suspense>;
}
