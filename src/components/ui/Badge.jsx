import clsx from "clsx";

/**
 * 状态标签 — 胶囊形仅用于标签（规范：full 圆角只允许出现在这里）
 * tone: neutral | primary | success | warning | danger
 */
export default function Badge({ tone = "neutral", className, children }) {
  const tones = {
    neutral: "bg-bg-page text-secondary-text border-divider",
    primary: "bg-primary-muted text-primary border-primary/30",
    success: "bg-success/10 text-success border-success/30",
    warning: "bg-warning/10 text-warning border-warning/30",
    danger: "bg-danger/10 text-danger border-danger/30",
  };
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium", tones[tone], className)}>
      {children}
    </span>
  );
}
