"use client";

import { useState } from "react";
import { useRemoteResource } from "@/hooks/useRemoteResource";
import { ArrowRight, Ban, Check, LoaderCircle, RotateCcw, Search, ShieldCheck, User } from "lucide-react";
import toast from "react-hot-toast";
import Modal from "@/components/ui/Modal";
import { requestKey } from "@/lib/client-api";

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

const operationErrors = {
  ADMIN_SCOPE_DENIED: "当前账号无权操作该用户",
  ADMIN_ROLE_DENIED: "只有 ROOT 可以变更管理角色",
  CROSS_ORIGIN_REQUEST: "站点地址配置不一致，请检查 NEXTAUTH_URL",
  IDEMPOTENCY_CONFLICT: "操作请求冲突，请关闭弹窗后重试",
  IDEMPOTENCY_KEY_REQUIRED: "无法创建操作标识，请刷新页面后重试",
  INSUFFICIENT_CREDITS: "用户可用积分不足，无法完成扣减",
  INVALID_INPUT: "提交内容不合法，请检查积分和操作原因",
};

/**
 * 用户管理 — 搜索/筛选/排序/分页 + 行内操作（调积分/角色/封禁，全走后端审计）
 */
export default function AdminUsers() {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [acting, setActing] = useState(null);
  const [creditDeltas, setCreditDeltas] = useState({});
  const [operation, setOperation] = useState(null);
  const [reason, setReason] = useState("");

  const params = new URLSearchParams({ page: String(page), sort, q: query, role, status });
  const { data, loading, error, reload: load } = useRemoteResource(`/api/admin/users?${params}`);

  const search = e => { e.preventDefault(); setPage(1); setQuery(q.trim()); load(); };

  const patch = (id, body, note, options = {}) => {
    try {
      setOperation({ id, body, note, key: requestKey(), ...options });
      setReason("");
    } catch {
      toast.error("无法创建操作请求，请刷新页面后重试");
    }
  };
  const confirm = async event => {
    event.preventDefault();
    const currentOperation = operation;
    const { id, body, note, key } = currentOperation;
    setActing(id);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ id, ...body, reason }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        const code = payload?.code || payload?.error;
        const trace = payload?.traceId ? `（追踪号 ${payload.traceId}）` : "";
        toast.error(`${operationErrors[code] || "操作失败，请稍后重试"}${trace}`);
        return;
      }
      toast.success(note);
      if (currentOperation.clearCreditInput) {
        setCreditDeltas(values => {
          const next = { ...values };
          delete next[id];
          return next;
        });
      }
      setOperation(null);
      load();
    } catch (error) {
      toast.error(error instanceof TypeError ? "网络连接失败，请检查服务状态" : "操作失败，请稍后重试");
    } finally {
      setActing(null);
    }
  };

  const grantCredits = (u) => {
    const n = Number(creditDeltas[u.id]);
    if (!Number.isInteger(n) || n === 0 || Math.abs(n) > 100000) {
      toast.error("请输入 -100000 到 100000 之间的非零整数");
      return;
    }
    patch(u.id, { creditsDelta: n }, `积分 ${n > 0 ? "+" : ""}${n}`, { clearCreditInput: true });
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
        <select value={sort} onChange={e => { setSort(e.target.value); setPage(1); }} className="bg-bg-card border border-divider rounded-full px-3 py-2 text-xs cursor-pointer">
          {SORTS.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}
        </select>
      </div>

      {/* 列表 */}
      {error ? <p role="alert" className="text-sm text-danger">加载失败，请重新搜索。</p> : loading ? (
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
                      <form className="flex items-center gap-1.5" onSubmit={event => { event.preventDefault(); grantCredits(u); }} onClick={e => e.stopPropagation()}>
                        <input
                          type="number"
                          step="1"
                          min="-100000"
                          max="100000"
                          placeholder="±积分"
                          aria-label={`调整 ${u.name || u.email} 的积分`}
                          value={creditDeltas[u.id] ?? ""}
                          onChange={e => setCreditDeltas(values => ({ ...values, [u.id]: e.target.value }))}
                          className="w-16 bg-bg-page border border-divider rounded px-1.5 py-1 text-xs tabular-nums"
                        />
                        <button
                          type="submit"
                          disabled={acting === u.id}
                          aria-label={`提交 ${u.name || u.email} 的积分调整`}
                          title="提交积分调整"
                          className="px-2 py-1 rounded border border-primary/40 text-primary text-xs hover:bg-primary-muted cursor-pointer disabled:opacity-40"
                        >{acting === u.id ? <LoaderCircle size={12} className="animate-spin" /> : <ArrowRight size={12} />}</button>
                        <button
                          type="button"
                          onClick={() => patch(u.id, { role: u.role === "user" ? "agent" : "user" }, u.role === "user" ? "已升为流量手" : "已降为普通用户")}
                          disabled={acting === u.id}
                          title="user ↔ agent 切换（admin/root 变更仅 ROOT）"
                          className="px-2 py-1 rounded border border-divider text-secondary-text hover:text-primary-text text-xs cursor-pointer disabled:opacity-40"
                        ><ShieldCheck size={12} /></button>
                        <button
                          type="button"
                          onClick={() => patch(u.id, { status: u.status === "banned" ? "active" : "banned" }, u.status === "banned" ? "已解封" : "已封禁")}
                          disabled={acting === u.id}
                          title={u.status === "banned" ? "解封" : "封禁"}
                          className={`px-2 py-1 rounded border text-xs cursor-pointer disabled:opacity-40 ${
                            u.status === "banned"
                              ? "border-success/40 text-success hover:bg-success/10"
                              : "border-danger/40 text-danger hover:bg-danger/10"
                          }`}
                        >{u.status === "banned" ? <RotateCcw size={12} /> : <Ban size={12} />}</button>
                      </form>
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
      {operation && <Modal label="确认用户变更" onClose={() => { if (!acting) setOperation(null); }}><form onSubmit={confirm}><h2>确认用户变更</h2><p>{operation.note}</p><label htmlFor="admin-reason">操作原因</label><input id="admin-reason" required minLength={3} maxLength={500} autoFocus value={reason} onChange={e => setReason(e.target.value)} /><div className="dialog-actions"><button type="button" className="button" disabled={!!acting} onClick={() => setOperation(null)}>取消</button><button type="submit" className="button primary" disabled={!!acting}>{acting && <LoaderCircle size={14} className="animate-spin" />}确认</button></div></form></Modal>}
    </div>
  );
}
