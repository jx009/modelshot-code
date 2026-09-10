"use client";

import clsx from "clsx";

/**
 * 分段控件（Segmented Control）
 * 用于互斥的少量选项：变体数 1|2|4、单张/批量等
 *
 * @param {Array<{value: string|number|boolean, label: string, title?: string}>} options
 * @param {*} value - 当前选中值
 * @param {(v) => void} onChange
 * @param {string} [size] - sm | md
 */
export default function Segmented({ options, value, onChange, size = "md", "aria-label": ariaLabel }) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex items-center rounded-full border border-divider bg-bg-page p-0.5"
    >
      {options.map(opt => {
        const active = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            role="radio"
            aria-checked={active}
            title={opt.title}
            onClick={() => onChange(opt.value)}
            className={clsx(
              "rounded-full font-medium transition-colors duration-[120ms] cursor-pointer",
              size === "sm" ? "px-2.5 py-1 text-xs min-h-[28px]" : "px-3.5 py-1.5 text-sm min-h-[36px]",
              active
                ? "bg-primary text-primary-btn-text"
                : "text-secondary-text hover:text-primary-text"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
