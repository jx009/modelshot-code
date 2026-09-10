"use client";

import { useState, useEffect } from "react";
import { Ban, Check, LoaderCircle, RotateCcw, Search, ShieldCheck, User } from "lucide-react";
import toast from "react-hot-toast";

const ROLES = ["", "user", "agent", "admin", "root"];
const STATUSES = ["", "active", "banned"];
const SORTS = [
  { v: "newest", l: "最新注册" },
  { v: "credits", l: "积分最多" },
  { v: "tryons", l: "生成最多" },
];

const roleCls = {
  user: "text-secondary-text bg-bg-page border-divider",
  agent: "text-warning bg-warning/10 border-warning/30",
  admin: "text-primary bg-primary-muted border-primary/30",
  root: "text-danger bg-danger/10 border-danger/30",
};

/**
 * 用户管理 — 搜索/筛选/排序/分页 + 行内操作（调积分/角色/封禁，全走后端审计）
 */
export default function AdminUsers() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [acting, setActing] = useState(null);
  const [creditDelta, setCreditDelta] = useState("");

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), sort });
      if (q) params.set("q", q);
      if (role) params.set("role", role);
      if (status) params.set("status", status);
      const res = await fetch(`/api/admin/users?${params}`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [role, status, sort, page]);

  const search = e => { e.preventDefault(); setPage(1); load(); };

  const patch = async (id, body, note) => {
    setActing(id);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      const text = await res.text();
      if (!res.ok) {
        toast.error(text || "Failed");
        return;
      }
      toast.success(note);
      await load();
    } catch {
      toast.error("Failed");
    } finally {
      setActing(null);
    }
  };

  const grantCredits = async (u) => {
    const n = parseInt(creditDelta, 10);
    if (!n || n === 0) { toast.error("输入积分增减值（如 100 或 -50）"); return; }
    await patch(u.id, { creditsDelta: n }, `Credits ${n > 0 ? "+" : ""}${n}`);
    setCreditDelta("");
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-base font-medium text-primary-text">用户管理</h1>
        <p className="text-xs text-secondary-text mt-1">四级角色（user/agent/admin/root）· 所有操作写审计日志</p>
      </div>

      {/* 搜索 + 筛选 */}
      <div className="flex gap-2 flex-wrap items-center">
        <form onSubmit={search} className="relative flex-1 min-w-[200px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary-text" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="搜索邮箱 / 昵称…"
            className="w-full bg-bg-card border border-divider rounded-full pl-8 pr-3 py-2 text-xs text-primary-text placeholder-secondary-text/50 focus:outline-none focus:border-primary/50"
          />
        </form>
        <select value={role} onChange={e => { setRole(e.target.value); setPage(1); }} className="bg-bg-card border border-divider rounded-full px-3 py-2 text-xs cursor-pointer">
          {ROLES.map(r => <option key={r} value={r}>{r || "全部角色"}</option>)}
        </select>
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} className="bg-bg-card border border-divider rounded-full px-3 py-2 text-xs cursor-pointer">
          {STATUSES.map(s => <option key={s} value={s}>{s || "全部状态"}</option>)}
        </select>
        <select value={sort} onChange={e => setSort(e.target.value)} className="bg-bg-card border border-divider rounded-full px-3 py-2 text-xs cursor-pointer">
          {SORTS.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}
        </select>
      </div>

      {/* 列表 */}
      {loading ? (
        <div className="flex items-center gap-2 text-secondary-text text-sm py-10"><LoaderCircle className="animate-spin" size={14} /> Loading…</div>
      ) : !data || data.users.length === 0 ? (
        <p className="text-sm text-secondary-text py-10 text-center">无匹配用户</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-[12px] border border-divider">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-bg-card/60 text-secondary-text">
                  <th className="text-left px-4 py-2.5 font-medium">用户</th>
                  <th className="text-left px-4 py-2.5 font-medium">角色</th>
                  <th className="text-left px-4 py-2.5 font-medium">状态</th>
                  <th className="text-left px-4 py-2.5 font-medium">套餐</th>
                  <th className="text-right px-4 py-2.5 font-medium">积分</th>
                  <th className="text-right px-4 py-2.5 font-medium">本月用量</th>
                  <th className="text-right px-4 py-2.5 font-medium">累计生成</th>
                  <th className="text-left px-4 py-2.5 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {data.users.map(u => (
                  <tr key={u.id} className={`border-t border-divider/60 hover:bg-bg-card/40 ${u.status === "banned" ? "opacity-50" : ""}`}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        {u.image
                          ? // eslint-disable-next-line @next/next/no-img-element
                            <img src={u.image} alt="" className="w-6 h-6 rounded-full object-cover" />
                          : <span className="w-6 h-6 rounded-full bg-bg-page border border-divider flex items-center justify-center"><User size={11} className="text-secondary-text" /></span>}
                        <div>
                          <div className="text-primary-text">{u.name || "—"}</div>
                          <div className="text-secondary-text/70">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full border text-xs font-medium ${roleCls[u.role]}`}>{u.role}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      {u.status === "banned"
                        ? <span className="text-danger font-medium">已封禁</span>
                        : <span className="text-success font-medium flex items-center gap-1"><Check size={11} />正常</span>}
                    </td>
                    <td className="px-4 py-2.5 text-secondary-text">{u.plan}</td>
                    <td className="px-4 py-2.5 text-right text-primary-text tabular-nums">{u.credits}</td>
                    <td className="px-4 py-2.5 text-right text-secondary-text tabular-nums">{u.monthUsage}</td>
                    <td className="px-4 py-2.5 text-right text-secondary-text tabular-nums">{u.tryonCount}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                        <input
                          type="number"
                          placeholder="±积分"
                          value={acting === u.id ? creditDelta : ""}
                          onChange={e => setCreditDelta(e.target.value)}
                          onFocus={() => setActing(u.id)}
                          className="w-16 bg-bg-page border border-divider rounded px-1.5 py-1 text-xs tabular-nums"
                        />
                        <button
                          onClick={() => grantCredits(u)}
                          disabled={acting === u.id}
                          className="px-2 py-1 rounded border border-primary/40 text-primary text-xs hover:bg-primary-muted cursor-pointer disabled:opacity-40"
                        >→</button>
                        <button
                          onClick={() => patch(u.id, { role: u.role === "user" ? "agent" : "user" }, u.role === "user" ? "已升为流量手" : "已降为普通用户")}
                          disabled={acting === u.id}
                          title="user ↔ agent 切换（admin/root 变更仅 ROOT）"
                          className="px-2 py-1 rounded border border-divider text-secondary-text hover:text-primary-text text-xs cursor-pointer disabled:opacity-40"
                        ><ShieldCheck size={12} /></button>
                        <button
                          onClick={() => patch(u.id, { status: u.status === "banned" ? "active" : "banned" }, u.status === "banned" ? "已解封" : "已封禁")}
                          disabled={acting === u.id}
                          title={u.status === "banned" ? "解封" : "封禁"}
                          className={`px-2 py-1 rounded border text-xs cursor-pointer disabled:opacity-40 ${
                            u.status === "banned"
                              ? "border-success/40 text-success hover:bg-success/10"
                              : "border-danger/40 text-danger hover:bg-danger/10"
                          }`}
                        >{u.status === "banned" ? <RotateCcw size={12} /> : <Ban size={12} />}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-xs text-secondary-text">
            <span>共 {data.total} 人 · 第 {data.page} 页</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 py-1.5 rounded border border-divider hover:bg-bg-card disabled:opacity-40 cursor-pointer">上一页</button>
              <button onClick={() => setPage(p => (p * data.limit < data.total ? p + 1 : p))} disabled={page * data.limit >= data.total} className="px-3 py-1.5 rounded border border-divider hover:bg-bg-card disabled:opacity-40 cursor-pointer">下一页</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
