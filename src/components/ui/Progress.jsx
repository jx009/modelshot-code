import clsx from "clsx";

/** 进度条 — 批量任务等 */
export default function Progress({ value = 0, total = 100, className }) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <div className={clsx("h-1 bg-bg-elevated rounded-full overflow-hidden", className)}>
      <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
    </div>
  );
}
