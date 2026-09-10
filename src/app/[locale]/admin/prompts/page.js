"use client";

import { useEffect, useState, useCallback } from "react";
import toast from "react-hot-toast";
import clsx from "clsx";

const VARIABLES = ["{{gender}}", "{{garmentDesc}}", "{{sceneDesc}}", "{{modelDesc}}"];

export default function AdminPrompts() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // 正在编辑的模板
  const [draft, setDraft] = useState("");

  const load = useCallback(() => {
    fetch("/api/admin/prompts")
      .then(r => r.json())
      .then(setTemplates)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save(id, payload) {
    const res = await fetch("/api/admin/prompts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...payload }),
    });
    if (res.ok) {
      toast.success("Saved · Immediately effective");
      setEditing(null);
      load();
    } else toast.error("Save failed");
  }

  if (loading) return <div className="text-secondary-text text-sm">Loading...</div>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-black tracking-tight">Prompt Template Management</h1>
        <p className="text-xs text-secondary-text mt-1">
          Templates take effect immediately after editing (30s cache auto-expires, manual save clears immediately). Supports variables:
          {VARIABLES.map(v => <code key={v} className="mx-1 px-1 bg-bg-page rounded text-primary">{v}</code>)}
        </p>
      </div>

      <div className="space-y-3">
        {templates.map(t => (
          <div key={t.id} className="bg-bg-card border border-divider rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2.5">
                <span className="text-sm font-black">{t.name}</span>
                <span className="text-[9px] font-black uppercase bg-primary/10 text-primary px-2 py-0.5 rounded-full">{t.category}</span>
                {!t.isActive && (
                  <span className="text-[9px] font-black uppercase bg-danger/15 text-danger px-2 py-0.5 rounded-full">Disabled</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => save(t.id, { isActive: !t.isActive })}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                    t.isActive
                      ? "bg-success/10 border-success/30 text-success"
                      : "bg-bg-page border-divider text-secondary-text"
                  }`}
                >
                  {t.isActive ? "Enabled" : "Disabled"}
                </button>
                <button
                  onClick={() => { setEditing(editing === t.id ? null : t.id); setDraft(t.template); }}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-colors cursor-pointer"
                >
                  {editing === t.id ? "Cancel Edit" : "Edit Template"}
                </button>
              </div>
            </div>

            {editing === t.id ? (
              <div className="space-y-2.5">
                <textarea
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  rows={6}
                  className="w-full bg-bg-page border border-divider rounded-lg px-3 py-2.5 text-xs font-medium leading-relaxed focus:outline-none focus:border-primary transition-colors"
                />
                <div className="flex items-center justify-between">
                  <p className="text-[10px] text-secondary-text">
                    Save takes effect immediately · The engine prioritizes this template, if disabled it falls back to the built-in template
                  </p>
                  <button
                    onClick={() => save(t.id, { template: draft })}
                    className="px-4 py-2 rounded-lg text-xs font-medium bg-primary text-primary-btn-text hover:bg-primary-hover transition-colors cursor-pointer"
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-secondary-text bg-bg-page/50 rounded-lg p-3 leading-relaxed line-clamp-3">
                {t.template}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
