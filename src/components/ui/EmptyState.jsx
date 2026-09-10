import clsx from "clsx";

/** 空状态 — 图库无记录 / 无预设等 */
export default function EmptyState({ icon, title, subtitle, action, className }) {
  return (
    <div className={clsx("text-center py-12 px-6", className)}>
      {icon && <div className="mx-auto mb-4 w-12 h-12 rounded-xl bg-bg-card border border-divider flex items-center justify-center text-secondary-text">{icon}</div>}
      <h3 className="text-base font-medium text-primary-text">{title}</h3>
      {subtitle && <p className="text-xs text-secondary-text mt-2 max-w-xs mx-auto leading-relaxed">{subtitle}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
