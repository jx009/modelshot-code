"use client";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useLocale } from "next-intl";
import { api } from "@/lib/client-api";
import { formatMoney } from "@/lib/domain/billing/catalog";
import { Link } from "@/i18n/navigation";
import Modal from "./ui/Modal";
import "./account-records.css";

export default function AccountRecords({ initialTab = "usage", onClose, returnFocusRef }) {
  const locale = useLocale(), zh = locale === "zh";
  const [tab, setTab] = useState(initialTab), [page, setPage] = useState(1), [data, setData] = useState(null), [error, setError] = useState(""), [loading, setLoading] = useState(false);
  useEffect(() => {
    if (tab === "help") return;
    const abort = new AbortController();
    Promise.resolve().then(() => { if (!abort.signal.aborted) { setLoading(true); setError(""); } });
    api(`/api/account?page=${page}`, { signal: abort.signal }).then(setData).catch(err => { if (!abort.signal.aborted) setError(err.message); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [page, tab]);
  const rows = tab === "orders" ? data?.orders : data?.transactions;
  const types = zh ? { consume: "使用", refund: "退回", purchase: "购买", grant: "赠送", release: "解除预留", capture: "任务结算", succeeded: "成功", paid: "已支付", pending: "处理中", refunded: "已退款", failed: "失败" } : {};
  return <Modal label={zh ? "账户与记录" : "Account records"} className="ma-dialog" onClose={onClose} returnFocusRef={returnFocusRef}>
    <header><h2>{zh ? "账户与记录" : "Account records"}</h2><button className="icon-button" aria-label={zh ? "关闭账户记录" : "Close account records"} onClick={onClose}><X size={20} /></button></header>
    <nav aria-label={zh ? "记录类型" : "Record type"}>{[["usage", "使用记录", "Usage history"], ["orders", "购买记录", "Purchases"], ["help", "使用指南", "Help"]].map(([id, cn, en]) => <button key={id} aria-pressed={tab === id} onClick={() => { setTab(id); setPage(1); }}>{zh ? cn : en}</button>)}</nav>
    {tab === "help" ? <div className="ma-scroll ma-help">
      <h3>{zh ? "项目与画布" : "Projects and canvas"}</h3><p>{zh ? "第一段创作描述会成为项目名称。原图、生成结果、对话和画布布局自动保存到项目；顶部历史入口可返回最近项目。空白项目不会自动加入项目库。" : "Your first request names the project. Original images, results, conversation and canvas layout save automatically. Recent projects lets you return to your work. Empty projects are not saved to the library."}</p>
      <h3>{zh ? "物体移动与局部修改" : "Move objects and edit areas"}</h3><p>{zh ? "选中图片后打开物体移动，框住完整对象，再调整目标位置并提交。结果作为新的完整场景加入画布。局部修改可直接涂抹区域；按住空格或使用平移按钮查看画面不会退出工具。" : "Select an image, choose Move object, frame the whole object and adjust its destination before applying. The complete scene is added as a new image. Paint areas for local edits; Space or Pan changes the view without leaving the tool."}</p>
      <h3>{zh ? "任务与积分" : "Tasks and credits"}</h3><p>{zh ? "右上角星光按钮查看当前项目任务。生成成功但图片加载失败时，使用“重试加载”不会重新生成或扣费。提示词优化使用管理员配置的语言模型，费用显示在按钮上。" : "The sparkle button shows project tasks. Retry loading fetches an already generated image without generating or charging again. Prompt optimization uses the admin-configured language model at the price shown."}</p>
      <h3>{zh ? "素材与快捷键" : "Assets and shortcuts"}</h3><p>{zh ? "@ 引用项目图片，* 选择素材库图片。Ctrl/⌘+Enter 发送，Ctrl/⌘+S 保存，Ctrl/⌘+Z 撤销。素材移入回收站后保留 30 天；被项目引用的原图仍会保留。" : "Use @ for project images and * for library assets. Ctrl/⌘+Enter sends, Ctrl/⌘+S saves, Ctrl/⌘+Z undoes. Library trash retains items for 30 days; images referenced by projects stay available."}</p>
    </div> : <>
      {data?.usage && <p>{zh ? "当前可用积分" : "Currently available credits"}: {data.usage.credits} · {zh ? "任务预留" : "Reserved"}: {data.usage.reservedCredits}</p>}
      {error && <p role="alert">{error}</p>}
      <div className="ma-scroll" aria-busy={loading}><table><thead><tr>{(tab === "orders" ? zh ? ["时间", "方案", "金额", "状态"] : ["Date", "Plan", "Amount", "Status"] : zh ? ["时间", "类型", "增减", "说明"] : ["Date", "Type", "Change", "Details"]).map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{!loading && rows?.map(row => <tr key={row.id}><td>{new Date(row.createdAt).toLocaleString(locale)}</td>{tab === "orders" ? <><td>{row.planId}</td><td>{formatMoney(row.amountMinor, row.currency, locale)}</td><td>{types[row.status] || row.status}</td></> : <><td>{types[row.type] || row.type}</td><td>{row.amount > 0 ? "+" : ""}{row.amount} {row.channel === "subscription" ? zh ? "额度" : "quota" : zh ? "积分" : "credits"}</td><td>{types[row.reason] || row.reason || (row.tryOnId ? zh ? "生成任务" : "Generation" : "—")}</td></>}</tr>)}</tbody></table>{loading ? <p role="status">{zh ? "正在加载…" : "Loading…"}</p> : !rows?.length && <p>{zh ? "暂无记录" : "No records yet"}</p>}</div>
      <footer><button disabled={loading || page === 1} onClick={() => setPage(value => value - 1)}>{zh ? "上一页" : "Previous"}</button><span>{page}</span><button disabled={loading || (rows?.length || 0) < (tab === "orders" ? 20 : 30)} onClick={() => setPage(value => value + 1)}>{zh ? "下一页" : "Next"}</button><Link href="/account" onClick={onClose}>{zh ? "账户管理" : "Manage account"}</Link></footer>
    </>}
  </Modal>;
}
