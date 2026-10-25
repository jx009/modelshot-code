// Shared labels and keys only; safe to import in the administrator UI.
export const CREATION_ACCESS_FLAGS = [
  { key: "workspace", env: "CREATION_WORKSPACE_ENABLED", label: "创作工作台" },
  { key: "runs", env: "CREATION_RUNS_ENABLED", label: "AI 创作任务" },
  { key: "poster", env: "CREATION_POSTER_ENABLED", label: "海报设计" },
  { key: "slides", env: "CREATION_SLIDES_ENABLED", label: "演示文稿" },
  { key: "document", env: "CREATION_DOCUMENT_ENABLED", label: "文档" },
  { key: "sheet", env: "CREATION_SHEET_ENABLED", label: "表格" },
  { key: "web", env: "CREATION_WEB_ENABLED", label: "网页" },
];

export const CREATION_CONTENT_KINDS = CREATION_ACCESS_FLAGS.slice(2).map(flag => flag.key);
