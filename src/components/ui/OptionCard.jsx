"use client";

import clsx from "clsx";

/**
 * 图示选项卡（摄影维度选项：姿态/相机/光线的可视化选择）
 * 选中态 = 强调色边框 + 四角取景框标记（视觉母题）
 *
 * @param {React.ElementType} icon - lucide 图标组件
 * @param {string} label - 显示标签（已 i18n）
 * @param {boolean} selected - 选中态
 * @param {() => void} onClick
 */
export default function OptionCard({ icon: Icon, label, selected, onClick, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={selected}
      className={clsx(
        "group relative flex flex-col items-center justify-center gap-1.5 rounded-lg border px-2 py-2.5 min-h-[64px] transition-colors duration-[120ms] cursor-pointer",
        selected
          ? "border-primary bg-primary-muted"
          : "border-divider bg-bg-card hover:border-divider-strong hover:bg-bg-card-hover"
      )}
    >
      <Icon
        size={18}
        strokeWidth={1.75}
        className={selected ? "text-primary" : "text-secondary-text group-hover:text-primary-text"}
      />
      <span
        className={clsx(
          "text-xs font-medium leading-none text-center",
          selected ? "text-primary" : "text-secondary-text group-hover:text-primary-text"
        )}
      >
        {label}
      </span>
    </button>
  );
}
