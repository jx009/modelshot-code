"use client";

import { useState, useEffect, useRef } from "react";
import { ImagePlus, LoaderCircle, Plus, Trash2, Upload, X } from "lucide-react";
import toast from "react-hot-toast";

const GENDERS = ["female", "male"];
const ETHNICITIES = ["asian", "caucasian", "african", "latin"];
const BODY_TYPES = ["slim", "standard", "plus"];

/**
 * 模特预设管理（真人模特参考图库）— 修复历史 bug：此页曾错接 providers API
 * 上传参考图 + 双语名 + 属性（性别/人种/体型）+ 开关排序
 */
export default function AdminModels() {
  const [models, setModels] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(null);
  // 新建表单
  const [form, setForm] = useState({ name: "", nameEn: "", gender: "female", ethnicity: "asian", bodyType: "standard", sortOrder: 99 });
  const [uploadingImg, setUploadingImg] = useState(false);
  const fileRef = useRef(null);

  async function load() {
    try {
      const res = await fetch("/api/admin/presets?type=models");
      if (res.ok) setModels(await res.json());
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  // 图片上传（复用 /api/upload）
  const uploadImage = async file => {
    if (!file) return;
    setUploadingImg(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setForm(f => ({ ...f, referenceImage: data.url }));
      toast.success("图片已上传");
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploadingImg(false);
    }
  };

  const create = async () => {
    if (!form.name.trim() || !form.referenceImage) {
      toast.error("需要名称 + 参考图");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/admin/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "models", ...form }),
      });
      if (!res.ok) throw new Error();
      toast.success("模特已添加");
      setForm({ name: "", nameEn: "", gender: "female", ethnicity: "asian", bodyType: "standard", sortOrder: 99 });
      await load();
    } catch {
      toast.error("Create failed");
    } finally {
      setCreating(false);
    }
  };

  const patch = async (id, data, note) => {
    setSaving(id);
    try {
      const res = await fetch("/api/admin/presets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, type: "models", ...data }),
      });
      if (!res.ok) throw new Error();
      toast.success(note);
      await load();
    } catch {
      toast.error("Save failed");
    } finally {
      setSaving(null);
    }
  };

  const remove = async m => {
    if (!confirm(`删除模特「${m.name}」？`)) return;
    setSaving(m.id);
    try {
      const res = await fetch(`/api/admin/presets?type=models&id=${m.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("已删除");
      await load();
    } catch {
      toast.error("Delete failed");
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return <div className="flex items-center gap-2 text-secondary-text text-sm py-10"><LoaderCircle className="animate-spin" size={14} /> Loading…</div>;
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-base font-medium text-primary-text">模特预设</h1>
        <p className="text-xs text-secondary-text mt-1">真人模特参考图库——工作台「模特与场景」区块从这里取数。参考图建议 3:4 竖版、全身、光线均匀。</p>
      </div>

      {/* 新建卡片 */}
      <div className="rounded-[16px] border border-primary/40 bg-primary-muted/20 p-5 space-y-4">
        <h2 className="text-sm font-medium text-primary-text flex items-center gap-2"><Plus size={14} /> 添加模特</h2>
        <div className="flex flex-col md:flex-row gap-4">
          {/* 上传参考图 */}
          <div className="w-full md:w-32 flex-shrink-0">
            <div
              className="aspect-[3/4] rounded-[10px] border border-dashed border-divider bg-bg-page overflow-hidden cursor-pointer flex items-center justify-center hover:border-primary/50 transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              {form.referenceImage ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={form.referenceImage} alt="" className="w-full h-full object-cover" />
                  <button
                    onClick={e => { e.stopPropagation(); setForm(f => ({ ...f, referenceImage: "" })); }}
                    className="absolute relative -mt-[136px] ml-[88px] w-5 h-5 rounded-full bg-danger text-bg-page flex items-center justify-center"
                  >
                    <X size={11} />
                  </button>
                </>
              ) : (
                <span className="flex flex-col items-center gap-1.5 text-secondary-text">
                  {uploadingImg ? <LoaderCircle size={16} className="animate-spin" /> : <ImagePlus size={16} />}
                  <span className="text-xs">{uploadingImg ? "上传中…" : "上传参考图"}</span>
                </span>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => uploadImage(e.target.files?.[0])} />
          </div>

          {/* 属性表单 */}
          <div className="flex-1 grid grid-cols-2 gap-3">
            <Input label="中文名 *" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="亚洲女模-01" />
            <Input label="英文名" value={form.nameEn} onChange={v => setForm(f => ({ ...f, nameEn: v }))} placeholder="Asian Female 01" />
            <Select label="性别" value={form.gender} onChange={v => setForm(f => ({ ...f, gender: v }))} options={GENDERS} />
            <Select label="人种" value={form.ethnicity} onChange={v => setForm(f => ({ ...f, ethnicity: v }))} options={ETHNICITIES} />
            <Select label="体型" value={form.bodyType} onChange={v => setForm(f => ({ ...f, bodyType: v }))} options={BODY_TYPES} />
            <Input label="排序" type="number" value={form.sortOrder} onChange={v => setForm(f => ({ ...f, sortOrder: parseInt(v, 10) || 99 }))} />
            <div className="col-span-2 flex justify-end">
              <button
                onClick={create}
                disabled={creating}
                className="h-9 px-5 rounded-[10px] bg-primary hover:bg-primary-hover text-primary-btn-text text-xs font-medium cursor-pointer btn-sheen disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {creating ? <LoaderCircle size={12} className="animate-spin" /> : <Upload size={12} />}
                添加
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 列表 */}
      {!models || models.length === 0 ? (
        <p className="text-sm text-secondary-text py-10 text-center">暂无模特预设</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {models.map(m => (
            <div key={m.id} className={`rounded-[12px] border overflow-hidden group ${m.isActive ? "border-divider bg-bg-card surface-lit" : "border-divider/50 opacity-50"}`}>
              <div className="relative aspect-[3/4] bg-bg-page">
                {m.referenceImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.referenceImage} alt={m.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-secondary-text text-xs">无图</div>
                )}
                <div className="absolute inset-x-0 bottom-0 bg-bg-page/85 px-2 py-1.5">
                  <div className="text-xs font-medium text-primary-text truncate">{m.name}</div>
                  <div className="text-[10px] text-secondary-text truncate">{m.nameEn}</div>
                </div>
                {/* hover 操作 */}
                <div className="absolute inset-x-0 top-0 p-1.5 flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => patch(m.id, { isActive: !m.isActive }, m.isActive ? "已停用" : "已启用")}
                    disabled={saving === m.id}
                    className="px-2 py-0.5 rounded bg-bg-card/90 backdrop-blur border border-divider text-xs font-medium cursor-pointer"
                  >{m.isActive ? "停用" : "启用"}</button>
                  <button
                    onClick={() => remove(m)}
                    disabled={saving === m.id}
                    className="w-6 h-6 rounded bg-bg-card/90 backdrop-blur border border-danger/40 text-danger flex items-center justify-center cursor-pointer"
                  ><Trash2 size={11} /></button>
                </div>
              </div>
              <div className="px-2 py-1.5 text-[10px] text-secondary-text flex justify-between">
                <span>{m.gender}/{m.ethnicity}/{m.bodyType}</span>
                <span>#{m.sortOrder}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Input({ label, value, onChange, placeholder, type = "text" }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-secondary-text">{label}</span>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-bg-page border border-divider rounded-[10px] px-3 py-2 text-xs text-primary-text placeholder-secondary-text/50 focus:outline-none focus:border-primary/50"
      />
    </label>
  );
}
function Select({ label, value, onChange, options }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-secondary-text">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full bg-bg-page border border-divider rounded-[10px] px-3 py-2 text-xs text-primary-text cursor-pointer"
      >
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
