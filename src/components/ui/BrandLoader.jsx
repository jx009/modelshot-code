import "./brand-loader.css";

// 全站统一的加载动画：品牌标志三条笔画依次绘制、橙色方块弹出，外圈光环环绕旋转。
// variant：page 占满页面内容区；panel 填满所在面板；inline 紧凑一行（编辑器、弹窗等局部加载）。
// 纯标记与 CSS，可在服务端组件（路由 loading.js）和客户端组件中使用。
export default function BrandLoader({ label, variant = "page", className = "" }) {
  return <div className={`bl-loader bl-${variant} ${className}`.trim()} role="status" aria-live="polite" aria-label={label}>
    <div className="bl-stage" aria-hidden="true">
      <span className="bl-halo" />
      <span className="bl-ring" />
      <span className="bl-orbit"><i /><i /><i /></span>
      <svg className="bl-mark" viewBox="0 0 176 160" focusable="false">
        <rect className="bl-bar bl-bar-1" width="65.4884" height="36.8372" rx="10.2326" />
        <rect className="bl-dot" x="77.767" width="36.8372" height="36.8372" rx="10.2326" />
        <rect className="bl-bar bl-bar-2" y="61.395" width="126.8837" height="36.8372" rx="10.2326" />
        <rect className="bl-bar bl-bar-3" y="122.791" width="176" height="36.8372" rx="10.2326" />
      </svg>
    </div>
    {variant !== "inline" ? <>
      <p className="bl-label"><span>{label}</span><span className="bl-dots" aria-hidden="true"><i /><i /><i /></span></p>
      <span className="bl-progress" aria-hidden="true"><i /></span>
    </> : <span className="bl-label"><span>{label}</span></span>}
  </div>;
}
