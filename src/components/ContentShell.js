"use client";

import Footer from "./Footer";

/**
 * 内容壳（ContentShell）—— 落地页 / 定价 / 图库 / 登录等文档流页面统一布局
 * 页面级滚动（滚动条贴视口右缘）+ 自动挂 Footer
 * 工作台（视口锁定三区）不适用本壳，用 .app-shell 类
 */
export default function ContentShell({ children, className = "" }) {
  return (
    <div className={`flex-1 flex flex-col bg-bg-page text-primary-text ${className}`}>
      {children}
      <Footer />
    </div>
  );
}
