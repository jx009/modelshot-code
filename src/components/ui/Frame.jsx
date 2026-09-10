import clsx from "clsx";

/**
 * Frame — 取景框（全站视觉母题）
 * 四角 L 形标记，呼应摄影/取景核心隐喻
 * active 时标记变强调色并伸长
 *
 * @param {boolean} active - 激活态（选中 / 生成中 / 成片）
 * @param {number} size - 角标长度 px（默认 12）
 * @param {string} className - 附加类
 */
export default function Frame({ active = false, size = 12, className, children, ...props }) {
  const cornerBase = "absolute pointer-events-none transition-all duration-[120ms]";
  const cornerColor = active ? "border-[var(--color-primary)]" : "border-[var(--color-divider-strong)]";
  const s = active ? Math.max(size + 6, 18) : size;
  const style = { width: s, height: s };

  return (
    <div className={clsx("relative", className)} {...props}>
      {/* tl */}
      <span className={clsx(cornerBase, cornerColor, "top-0 left-0 border-t border-l")} style={style} />
      {/* tr */}
      <span className={clsx(cornerBase, cornerColor, "top-0 right-0 border-t border-r")} style={style} />
      {/* bl */}
      <span className={clsx(cornerBase, cornerColor, "bottom-0 left-0 border-b border-l")} style={style} />
      {/* br */}
      <span className={clsx(cornerBase, cornerColor, "bottom-0 right-0 border-b border-r")} style={style} />
      {children}
    </div>
  );
}
