import { notFound } from "next/navigation";
import { getCase } from "@/lib/commerce/catalog";
import CaseDetail from "@/components/discover/CaseDetail";
import InspirationDetail from "@/components/discover/InspirationDetail";
import { deliveredPublicGallery } from "@/lib/server/inspiration-cache";

// 作品详情只依赖公开配置：按需生成后缓存 5 分钟，管理端修改后最长 5 分钟生效。
export const revalidate = 300;

export default async function CasePage({ params }) {
  const { slug } = await params;
  const item = (await deliveredPublicGallery()).items.find(entry => entry.id === slug);
  if (item) return <InspirationDetail item={item} />;
  const legacy = getCase(slug);
  if (!legacy) notFound();
  return <CaseDetail item={legacy} />;
}
