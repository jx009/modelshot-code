# 性能优化方案（2026-09-28）

## 问题诊断

用户报告：**重启服务后首次加载需要 1 分钟以上**

### Bundle 分析结果

```bash
41M   node_modules/lucide-react      # 最大问题！
5.2M  node_modules/framer-motion
2.0M  node_modules/konva
1.2M  node_modules/sharp
104K  node_modules/react-konva
```

### 主要瓶颈

1. **lucide-react (41MB)** - 图标库体积过大，树摇不足
2. **framer-motion (5.2MB)** - 动画库体积较大
3. **Konva (2MB)** - Canvas 库已动态加载，但仍可优化

---

## 已完成的优化

### ✅ 1. Konva 动态加载

**文件：** `src/components/studio/StudioWorkbench.jsx`

```javascript
// 已实现：使用 dynamic import，避免首屏加载
const Canvas = dynamic(() => import("./StudioCanvas"), { 
  ssr: false, 
  loading: () => <div className="ms-loading"><LoaderCircle className="ms-spin" size={22} /></div> 
});
```

**效果：** Konva 不会在首屏加载，节省 ~2MB

---

### ✅ 2. 颜色提取延迟加载

**文件：** `src/components/studio/canvas/hooks/useImageColors.js`

**优化内容：**
- 添加 SSR 检查（`typeof window === "undefined"`）
- 延迟 300ms 执行颜色提取，优先渲染主界面
- 防止阻塞首屏渲染

```javascript
// 延迟 300ms 提取颜色，避免阻塞初始渲染
const timer = setTimeout(() => {
  extractDominantColors(`/api/assets/${selectedLayer.assetId}`, 5)
    .then(/* ... */)
    .catch(/* ... */);
}, 300);
```

**效果：** 减少首屏计算负担

---

### ✅ 3. Webpack Bundle 分割优化

**文件：** `next.config.js`

**新增配置：**

```javascript
experimental: {
  optimizePackageImports: ["lucide-react", "framer-motion"],
},

webpack(config, { isServer }) {
  if (!isServer) {
    config.optimization.splitChunks = {
      cacheGroups: {
        // 将 Konva 单独打包
        konva: {
          test: /[\\/]node_modules[\\/](konva|react-konva)[\\/]/,
          name: "konva",
          chunks: "async",
          priority: 10,
        },
        // 将大型 UI 库单独打包
        uiLibs: {
          test: /[\\/]node_modules[\\/](framer-motion|lucide-react)[\\/]/,
          name: "ui-libs",
          chunks: "async",
          priority: 9,
        },
      },
    };
  }
  return config;
}
```

**效果：** 
- 按需加载大型库
- 提高缓存命中率
- 减少首屏 bundle 体积

---

## 🔴 待实施的关键优化（需立即执行）

### 🚨 优先级 P0：修复 lucide-react 树摇问题

**问题：** lucide-react 占 41MB，说明树摇（tree-shaking）没有生效

**根本原因：** 可能的导入方式问题

#### 解决方案 A：检查导入语法（推荐）

确保所有文件使用**命名导入**而不是**默认导入**：

```javascript
// ✅ 正确 - 支持树摇
import { Camera, Save, Plus } from "lucide-react";

// ❌ 错误 - 无法树摇
import * as Icons from "lucide-react";
const { Camera, Save } = Icons;
```

**检查命令：**
```bash
cd /sessions/magical-gallant-meitner/mnt/modelshot-code
grep -r "import.*\*.*lucide-react" src/
```

#### 解决方案 B：使用 @lucide/react（备选）

如果树摇问题无法解决，考虑切换到优化版本：

```bash
npm install @lucide/react
npm uninstall lucide-react
```

**预期效果：** Bundle 体积减少 **30-35MB**（从 41MB → 6-10MB）

---

### 优先级 P1：framer-motion 按需加载

**当前问题：** framer-motion (5.2MB) 在所有页面都加载

**优化方案：**

1. **仅在需要动画的组件中动态导入**

```javascript
// 在组件级别动态加载
const MotionDiv = dynamic(() => 
  import('framer-motion').then(mod => ({ default: mod.motion.div })),
  { ssr: false }
);
```

2. **使用 LazyMotion + domAnimation**

```javascript
import { LazyMotion, domAnimation, m } from "framer-motion";

// 使用 <m.div> 替代 <motion.div>
<LazyMotion features={domAnimation}>
  <m.div animate={{ opacity: 1 }} />
</LazyMotion>
```

**预期效果：** 首屏减少 ~3-4MB

---

### 优先级 P2：字体优化

**当前配置：** `src/app/[locale]/layout.js`

```javascript
const instrumentSerif = localFont({
  src: [
    { path: "../../fonts/instrument-serif-400.woff2" },
    { path: "../../fonts/instrument-serif-400i.woff2" },
  ],
  display: "swap", // ✅ 已使用 swap
});
```

**建议：** 检查字体文件大小

```bash
ls -lh src/fonts/*.woff2
```

如果单个文件超过 200KB，考虑：
- 使用 `font-display: optional`
- 移除未使用的字重
- 使用 Google Fonts CDN（权衡 GDPR）

---

## 预期性能提升

| 优化项 | 当前体积 | 优化后 | 节省 |
|--------|---------|--------|------|
| lucide-react 树摇 | 41MB | ~6MB | -35MB |
| framer-motion 优化 | 5.2MB | ~2MB | -3MB |
| Konva 动态加载 | 2MB | 0（首屏） | -2MB |
| **总计** | **~50MB** | **~10MB** | **-40MB** |

**预期加载时间：**
- 当前：60-90 秒
- 优化后：**5-10 秒**（减少 **85%**）

---

## 验证步骤

### 1. 构建分析

```bash
# 安装分析工具
npm install --save-dev @next/bundle-analyzer

# 添加到 next.config.js
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

module.exports = withBundleAnalyzer(nextConfig);

# 运行分析
ANALYZE=true npm run build
```

### 2. 测试加载性能

```bash
# 清除缓存
rm -rf .next/

# 构建生产版本
npm run build

# 启动并测试
npm run start
```

### 3. Chrome DevTools 验证

1. 打开 Chrome DevTools (F12)
2. 切换到 **Network** 标签
3. 勾选 **Disable cache**
4. 刷新页面
5. 查看：
   - **Total transfer size**（应 < 3MB）
   - **First Contentful Paint**（应 < 2s）
   - **Time to Interactive**（应 < 5s）

---

## 后续优化建议

### 1. 图片优化
- 使用 WebP 格式
- 配置 `next.config.js` 图片压缩
- 启用 CDN

### 2. 代码分割
- 路由级别的代码分割
- 组件级别的懒加载
- API 路由优化

### 3. 缓存策略
- 配置 Service Worker
- 启用静态资源缓存
- Redis 缓存 API 响应

### 4. 服务端渲染优化
- 使用 React Server Components
- 减少客户端 JavaScript
- 优化数据预取

---

## 相关文件清单

### 已修改的文件
1. `src/components/studio/canvas/hooks/useImageColors.js` - 延迟颜色提取
2. `next.config.js` - Webpack 分割优化

### 需要检查的文件
1. `src/app/[locale]/studio/page.js` - lucide-react 导入
2. `src/components/studio/StudioWorkbench.jsx` - lucide-react 导入
3. `src/components/UserMenu.js` - lucide-react 导入
4. 其他所有使用 lucide-react 的文件（~30+ 个）

---

## 实施优先级

**立即执行（今天）：**
1. ✅ 完成 Konva 动态加载验证
2. ✅ 完成颜色提取延迟优化
3. ✅ 完成 Webpack 配置优化
4. 🔴 **修复 lucide-react 树摇问题**（最关键）

**本周内：**
5. framer-motion 按需加载
6. 构建分析和验证

**下周：**
7. 图片和字体优化
8. 缓存策略实施

---

## 联系人

- 优化负责人：Claude
- 日期：2026-09-28
- 预计完成：2026-10-05
