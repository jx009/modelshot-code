import clsx from "clsx";

/** 卡片 — 统一 12px 圆角、token 边框 */
export function Card({ className, children, ...props }) {
  return (
    <div className={clsx("bg-bg-card border border-divider rounded-[16px] surface-lit", className)} {...props}>
      {children}
    </div>
  );
}

/** 卡片标题区 */
export function CardHeader({ title, subtitle, action, className }) {
  return (
    <div className={clsx("flex items-start justify-between gap-3 p-5 pb-0", className)}>
      <div>
        <h3 className="text-base font-medium text-primary-text">{title}</h3>
        {subtitle && <p className="text-xs text-secondary-text mt-1">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/** 卡片内容区 */
export function CardBody({ className, children }) {
  return <div className={clsx("p-5", className)}>{children}</div>;
}
