"use client";

import { useState } from "react";
import { ChevronDown, FolderOpen } from "lucide-react";
import { useLocale } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import dynamic from "next/dynamic";
import { useNavigationRouter } from "@/hooks/useNavigationRouter";

const ProjectManager = dynamic(() => import("@/components/studio/ProjectManager"), { ssr: false });

// PPT 工作台顶栏的「切换项目」：与视频工作台同一个面板，只列出 PPT 项目。
// 放在外壳顶栏里，新建页（尚无项目）和项目内都可用；离开当前项目时由工作台的导航保护先保存。
export default function CreationProjectSwitch() {
  const locale = useLocale(), zh = locale === "zh", text = (cn, en) => zh ? cn : en;
  const { data: session } = useSession(), userId = session?.user?.id;
  const router = useNavigationRouter(), currentId = useSearchParams().get("project");
  const [open, setOpen] = useState(false);
  if (!userId) return null;
  return <>
    <button type="button" className="vm-projects" onClick={() => setOpen(true)} aria-haspopup="dialog" title={text("切换或新建 PPT 项目", "Switch or create slide projects")}>
      <FolderOpen size={14} />{text("切换项目", "Projects")}<ChevronDown size={12} />
    </button>
    {open && <ProjectManager userId={userId} locale={locale} scope="creation" kinds={["slides"]} currentId={currentId}
      onClose={() => setOpen(false)} creates={[{ href: "/creation", label: text("新建 PPT", "New deck") }]}
      onChoose={row => { setOpen(false); router.push(`/creation?project=${encodeURIComponent(row.id)}`); }} />}
  </>;
}
