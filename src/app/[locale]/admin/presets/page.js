"use client";

import { useEffect, useState, useCallback } from "react";
import toast from "react-hot-toast";

export default function AdminPresets() {
  const [tab, setTab] = useState("models"); // models | scenes
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fetch(`/api/admin/presets?type=${tab}`)
      .then(r => r.json())
      .then(setItems)
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  async function toggleActive(item) {
    const res = await fetch("/api/admin/presets", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, type: tab, isActive: !item.isActive }),
    });
    if (res.ok) { toast.success("Saved"); load(); } else toast.error("Failed");
  }

  async function remove(item) {
    if (!confirm(`删除「${item.name}」？`)) return;
    const res = await fetch(`/api/admin/presets?type=${tab}&id=${item.id}`, { method: "DELETE" });
    if (res.ok) { toast.success("Deleted"); load(); } else toast.error("Failed");
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-black tracking-tight">预设管理</h1>
        <p className="text-xs text-secondary-text mt-1">模特与场景预设——用户生图时的可选素材。</p>
      </div>

      <div className="flex gap-2">
        {[
          { id: "models", label: `模特预设` },
          { id: "scenes", label: `场景预设` },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-1.5 rounded-full text-xs font-bold border transition-colors cursor-pointer ${
              tab === t.id
                ? "bg-primary/15 border-primary/40 text-primary"
                : "bg-bg-card border-divider text-secondary-text hover:text-primary-text"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-secondary-text text-sm">Loading...</div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map(item => (
            <div key={item.id} className="bg-bg-card border border-divider rounded-xl p-3">
              <div className="flex items-start gap-3">
                {tab === "models" && item.referenceImage && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.referenceImage} alt={item.name} className="w-12 h-16 object-cover rounded-md border border-divider flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold truncate">{item.name}</div>
                  <div className="text-[10px] text-secondary-text mt-0.5">
                    {tab === "models"
                      ? `${item.gender} · ${item.ethnicity} · ${item.bodyType}`
                      : item.category}
                  </div>
                  {tab === "scenes" && item.promptSnippet && (
                    <div className="text-[10px] text-secondary-text mt-1 line-clamp-2">{item.promptSnippet}</div>
                  )}
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => toggleActive(item)}
                  className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] font-bold border transition-colors cursor-pointer ${
                    item.isActive
                      ? "bg-success/10 border-success/30 text-success"
                      : "bg-bg-page border-divider text-secondary-text"
                  }`}
                >
                  {item.isActive ? "上架中" : "已下架"}
                </button>
                <button
                  onClick={() => remove(item)}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-danger/10 border border-danger/20 text-danger hover:bg-danger/20 transition-colors cursor-pointer"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
