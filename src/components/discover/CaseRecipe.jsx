"use client";
import { useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useSession } from "next-auth/react";
import { useRouter } from "@/i18n/navigation";
import { WandSparkles, LoaderCircle } from "lucide-react";
import { api, requestKey } from "@/lib/client-api";
import { caseRecipe } from "@/lib/commerce/case-recipe";
export default function CaseRecipe({ item, zh }) {
  const auth = useAuth();
  const router = useRouter(), { status } = useSession(), pending = useRef(null), lock = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const recipe = caseRecipe(item, zh ? "zh" : "en");
  async function useRecipe() {
    if (status !== "authenticated") { auth.open(); return; }
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      pending.current ||= requestKey();
      const result = await api("/api/studio/cases", { method: "POST", body: { caseId: item.id, locale: zh ? "zh" : "en", createKey: pending.current } });
      router.push(`/studio-v2?document=${result.documentId}&mode=${result.mode}`);
    } catch (e) { setError(e.message); } finally { lock.current = false; setBusy(false); }
  }
  return <section className="cr-recipe"><span>{zh ? "可复用创作配方" : "REUSABLE RECIPE"}</span><dl><div><dt>{zh ? "画面比例" : "Ratio"}</dt><dd>{recipe.size === "1536x1024" ? "3:2" : "2:3"}</dd></div><div><dt>{zh ? "参考图片" : "Reference"}</dt><dd>1</dd></div><div><dt>{zh ? "生成方式" : "Mode"}</dt><dd>{zh ? "参考图编辑" : "Image edit"}</dd></div></dl><p>{zh ? "带入参考原图、创作描述和风格约束。在画布里选择你的模型后生成。" : "Load the source image, prompt and style instructions. Choose your model in the canvas."}</p><button className="cr-primary-button" disabled={busy} onClick={useRecipe}>{busy ? <LoaderCircle size={16} /> : <WandSparkles size={16} />}{zh ? "在画布中使用配方" : "Use recipe in canvas"}</button>{error && <p role="alert">{error}</p>}</section>;
}
