// Shared labels and keys only; safe to import in the administrator UI.
export const CREATION_ACCESS_FLAGS = [
  { key: "workspace", env: "CREATION_WORKSPACE_ENABLED", label: "创作工作台" },
  { key: "runs", env: "CREATION_RUNS_ENABLED", label: "AI 创作任务" },
  { key: "slides", env: "CREATION_SLIDES_ENABLED", label: "演示文稿" },
  { key: "video", env: "CREATION_VIDEO_ENABLED", label: "视频生成" },
  { key: "motion", env: "CREATION_MOTION_ENABLED", label: "视频制作" },
];

export const CREATION_CONTENT_KINDS = CREATION_ACCESS_FLAGS.slice(2).map(flag => flag.key);

// 已下线的创作类型：旧配置里的对应开关会被忽略，已有的同类资源一律拒绝访问。
export const RETIRED_CREATION_KINDS = ["poster", "document", "sheet", "web"];
