"use client";

import { useState, useEffect } from "react";
import { LoaderCircle, Mail, ShieldCheck, CreditCard, Zap } from "lucide-react";
import toast from "react-hot-toast";
import { useAdminReason } from "@/hooks/useAdminReason";

/**
 * 系统设置 — SMTP / Google OAuth / Stripe 三区
 * 配置顺序：DB（此处保存）> env 兜底；敏感项加密存储、界面脱敏
 * 保存与测试仅 ROOT（站点级凭据是危险操作）
 */

const SECTIONS = [
  {
    id: "smtp",
    icon: Mail,
    title: "邮件 SMTP",
    desc: "邮件服务未配置时暂停验证码发送。",
    fields: [
      { key: "smtp_host", label: "SMTP Host", placeholder: "smtp.exmail.qq.com" },
      { key: "smtp_port", label: "端口", placeholder: "465（SSL）/ 587（STARTTLS）" },
      { key: "smtp_user", label: "账号", placeholder: "noreply@yourdomain.com" },
      { key: "smtp_pass", label: "密码/授权码", sensitive: true, placeholder: "留空 = 不变更" },
      { key: "smtp_from", label: "发件人（可选）", placeholder: "ModelShot <noreply@yourdomain.com>" },
    ],
    test: { target: "smtp", label: "发送测试邮件", extraField: "testEmail", extraLabel: "收件邮箱（可选，默认发件人）" },
  },
  {
    id: "google",
    icon: ShieldCheck,
    title: "Google OAuth",
    desc: "Google Cloud Console 创建 OAuth 2.0 客户端（Web 应用）。redirect URI 配：/api/auth/callback/google",
    fields: [
      { key: "google_client_id", label: "Client ID", placeholder: "xxx.apps.googleusercontent.com" },
      { key: "google_client_secret", label: "Client Secret", sensitive: true, placeholder: "留空 = 不变更" },
    ],
    test: { target: "google", label: "校验凭据格式" },
  },
  {
    id: "stripe",
    icon: CreditCard,
    title: "Stripe 支付",
    desc: "Secret Key 用于创建 checkout；Webhook Secret 用于验签回调。",
    fields: [
      { key: "stripe_secret_key", label: "Secret Key", sensitive: true, placeholder: "sk_live_... / sk_test_..." },
      { key: "stripe_publishable_key", label: "Publishable Key", placeholder: "pk_live_..." },
      { key: "stripe_webhook_secret", label: "Webhook Secret", sensitive: true, placeholder: "whsec_..." },
    ],
    test: { target: "stripe", label: "查询余额验证 Key" },
  },
];

export default function AdminSettings() {
  const reasonPrompt = useAdminReason();
  const [configs, setConfigs] = useState([]); // [{key, source, display}]
  const [values, setValues] = useState({}); // 输入中的值
  const [savingKey, setSavingKey] = useState(null);
  const [testing, setTesting] = useState(null);
  const [testEmail, setTestEmail] = useState("");

  async function load() {
    const res = await fetch("/api/admin/settings");
    if (res.ok) {
      const d = await res.json();
      setConfigs(d.configs);
    }
  }
  useEffect(() => {
    let mounted = true;
    (async () => {
      const res = await fetch("/api/admin/settings");
      if (res.ok && mounted) {
        const d = await res.json();
        setConfigs(d.configs);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const configOf = key => configs.find(c => c.key === key);

  const save = async key => {
    const approval = await reasonPrompt.ask();
    if (!approval) return;
    const value = values[key];
    setSavingKey(key);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Idempotency-Key": approval.key },
        body: JSON.stringify({ key, value: value ?? "", reason: approval.reason }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed");
      toast.success(value ? "已保存（DB 优先生效）" : "已清除（回退 env）");
      setValues(v => ({ ...v, [key]: "" }));
      await load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSavingKey(null);
    }
  };

  const runTest = async target => {
    setTesting(target);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, testEmail: testEmail || undefined }),
      });
      const d = await res.json();
      if (d.ok) toast.success(d.message);
      else toast.error(d.error || "Test failed");
    } catch {
      toast.error("Test request failed");
    } finally {
      setTesting(null);
    }
  };

  return (
    <div className="space-y-5">
      {reasonPrompt.dialog}
      <div>
        <h1 className="text-base font-medium text-primary-text">系统设置</h1>
        <p className="text-xs text-secondary-text mt-1 leading-relaxed">
          配置读取顺序：<b className="text-primary-text">DB（此处保存）→ env 兜底</b>；敏感项 AES-256 加密存储、界面脱敏显示。
          保存后 60 秒内全站生效（配置缓存）。
        </p>
      </div>

      {SECTIONS.map(sec => (
        <div key={sec.id} className="rounded-[16px] border border-divider bg-bg-card surface-lit p-5 space-y-4">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-[10px] bg-primary-muted border border-primary/30 flex items-center justify-center text-primary">
              <sec.icon size={15} />
            </span>
            <div>
              <h2 className="text-sm font-medium text-primary-text">{sec.title}</h2>
              <p className="text-xs text-secondary-text mt-0.5">{sec.desc}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {sec.fields.map(f => {
              const c = configOf(f.key);
              return (
                <div key={f.key} className="space-y-1">
                  <label className="block text-xs text-secondary-text">
                    {f.label}
                    {c && (
                      <span className={`ml-2 font-medium ${c.source === "db" ? "text-success" : c.source === "env" ? "text-warning" : "text-secondary-text/60"}`}>
                        {c.source === "db" ? `DB：${c.display || "已配置"}` : c.source === "env" ? `env：${c.display}` : "未配置"}
                      </span>
                    )}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type={f.sensitive ? "password" : "text"}
                      value={values[f.key] ?? ""}
                      onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
                      placeholder={f.sensitive && c?.source !== "none" ? "留空 = 不变更" : f.placeholder}
                      className="flex-1 bg-bg-page border border-divider rounded-[10px] px-3 py-2 text-xs text-primary-text placeholder-secondary-text/50 focus:outline-none focus:border-primary/50"
                    />
                    <button
                      onClick={() => save(f.key)}
                      disabled={savingKey === f.key || !(values[f.key] ?? "").trim()}
                      className="px-3 rounded-[10px] border border-primary/40 text-primary text-xs font-medium hover:bg-primary-muted transition-colors cursor-pointer disabled:opacity-40 whitespace-nowrap"
                    >
                      {savingKey === f.key ? "…" : "保存"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 测试连接 */}
          <div className="flex items-center gap-3 flex-wrap">
            {sec.test.extraField && (
              <input
                type="email"
                value={testEmail}
                onChange={e => setTestEmail(e.target.value)}
                placeholder={sec.test.extraLabel}
                className="bg-bg-page border border-divider rounded-[10px] px-3 py-2 text-xs flex-1 min-w-[200px] max-w-xs"
              />
            )}
            <button
              onClick={() => runTest(sec.test.target)}
              disabled={testing === sec.test.target}
              className="h-9 px-4 rounded-[10px] bg-primary hover:bg-primary-hover text-primary-btn-text text-xs font-medium cursor-pointer btn-sheen disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {testing === sec.test.target ? <LoaderCircle size={12} className="animate-spin" /> : <Zap size={12} />}
              {sec.test.label}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
