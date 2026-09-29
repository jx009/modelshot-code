export function promptTitle(value, limit = 40) {
  const text = String(value || "").trim().replace(/\s+/gu, " ");
  const chars = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map(part => part.segment);
  return chars.slice(0, limit).join("") + (chars.length > limit ? "…" : "");
}

export function projectTitle(name, content = {}) {
  if (name?.trim() && !["Untitled", "未命名项目", "新建项目"].includes(name.trim())) return name.trim();
  const prompt = content.messages?.find(message => message.role === "user" && message.text?.trim());
  return promptTitle(prompt?.text) || promptTitle(content.layers?.find(layer => layer.type === "image")?.name?.replace(/\.[^.]+$/, "")) || "未命名项目";
}

export function documentContent(draft) {
  return { schemaVersion: 1, layers: draft.layers, messages: draft.messages, jobs: draft.jobs, appliedJobs: draft.appliedJobs || [], plan: draft.plan || null, ...(draft.composer ? { composer: draft.composer } : {}), ...(draft.commerce ? { commerce: draft.commerce } : {}) };
}
