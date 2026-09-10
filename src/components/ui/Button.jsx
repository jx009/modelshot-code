import clsx from "clsx";

/**
 * 按钮规范 — 酸性黄绿仅用于 primary（CTA 白名单）
 * variant: primary | secondary | ghost | danger
 */
export default function Button({ variant = "primary", size = "md", loading = false, disabled, className, children, ...props }) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-[10px] font-medium transition-all duration-[120ms] cursor-pointer select-none active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed";
  const sizes = {
    sm: "text-xs px-3 py-1.5 min-h-[32px]",
    md: "text-xs px-4 py-2.5 min-h-[40px]",
    lg: "text-sm px-6 py-3 min-h-[48px]",
  };
  const variants = {
    primary: "bg-primary text-primary-btn-text hover:bg-primary-hover btn-sheen",
    secondary: "bg-bg-card text-primary-text border border-divider hover:bg-bg-card-hover hover:border-divider-strong",
    ghost: "bg-transparent text-secondary-text hover:text-primary-text hover:bg-bg-card",
    danger: "bg-danger/10 text-danger border border-danger/30 hover:bg-danger/20",
  };
  return (
    <button className={clsx(base, sizes[size], variants[variant], className)} disabled={disabled || loading} {...props}>
      {loading && <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />}
      {children}
    </button>
  );
}
