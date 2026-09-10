import clsx from "clsx";

/**
 * 表单字段 — label + 控件的统一布局（规范：label 用 12px medium 次级色，不再用编号+大写）
 */
export default function Field({ label, hint, required, className, children }) {
  return (
    <div className={className}>
      {label && (
        <label className="block text-xs font-medium text-secondary-text mb-2">
          {label}
          {required && <span className="text-primary ml-0.5">*</span>}
        </label>
      )}
      {children}
      {hint && <p className="text-xs text-secondary-text/70 mt-1.5">{hint}</p>}
    </div>
  );
}

/** 统一输入/选择控件样式 */
export const inputCls =
  "w-full bg-bg-page border border-divider rounded-lg px-3.5 py-2.5 text-xs text-primary-text placeholder:text-secondary-text/50 focus:outline-none focus:border-primary transition-colors cursor-pointer";
