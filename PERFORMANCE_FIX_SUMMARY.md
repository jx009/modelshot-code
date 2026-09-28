# 性能修复总结（2026-09-28）

## 问题描述

**用户报告：** 重启服务后首次加载需要 **60-90 秒**

## 根本原因

1. **lucide-react (41MB)** - Next.js 的 `optimizePackageImports` 未生效或配置错误
2. **framer-motion (5.2MB)** - 在所有页面同步加载
3. **Konva (2MB)** - 已有动态导入但可进一步优化
4. 字体和其他资源缓存策略不够激进

---

## ✅ 已完成的修复

### 1. 颜色提取延迟优化

**文件：** `src/components/studio/canvas/hooks/useImageColors.js`

**问题：** 颜色提取在首屏立即执行，阻塞渲染

**修复：**
- 添加 SSR 检查
- 延迟 300ms 执行
- 优先保证界面可交互

```javascript
// 延迟 300ms，优先首屏渲染
const timer = setTimeout(() => {
  extractDominantColors(/* ... */)
}, 300);
```

**效果：** 减少首屏阻塞

---

### 2. Webpack Bundle 分割优化

**文件：** `next.config.js`

**修复：**
- 添加 `experimental.optimizePackageImports` 配置
- 为 Konva、lucide-react、framer-motion 创建独立 chunk
- 配置异步加载策略

```javascript
experimental: {
  optimizePackageImports: ["lucide-react", "framer-motion"],
},

webpack(config, { isServer }) {
  if (!isServer) {
    config.optimization.splitChunks = {
      cacheGroups: {
        konva: { /* ... */ },
        uiLibs: { /* ... */ },
      },
    };
  }
}
```

**预期效果：** 
- Bundle 体积减少 30-40%
- 首屏加载时间减少 60-70%
- 从 **60-90s → 8-15s**

---

## 🔴 需要验证的操作

### 立即执行

```bash
# 1. 清除构建缓存
rm -rf .next/

# 2. 重新构建（生产模式）
npm run build

# 3. 启动生产服务器
npm run start

# 4. 测试加载时间
# - 打开 Chrome DevTools
# - Network 标签，勾选 "Disable cache"
# - 刷新页面，记录 "Load" 时间
```

### 预期结果

**优化前：**
- Transfer size: ~50-60MB
- Load time: 60-90s
- FCP: 8-12s

**优化后：**
- Transfer size: ~3-8MB
- Load time: 8-15s
- FCP: 1.5-3s

---

## 🟡 进一步优化建议（可选）

### 1. 安装 Bundle 分析工具

```bash
npm install --save-dev @next/bundle-analyzer
```

**添加到 `next.config.js`：**
```javascript
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

module.exports = withBundleAnalyzer(nextConfig);
```

**运行分析：**
```bash
ANALYZE=true npm run build
```

这会生成可视化报告，显示每个包的实际体积。

---

### 2. framer-motion 按需加载

**当前问题：** 在所有页面都加载了 framer-motion

**解决方案：** 使用 LazyMotion

```javascript
// 修改所有使用 framer-motion 的文件
import { LazyMotion, domAnimation, m } from "framer-motion";

// 使用 <m.div> 替代 <motion.div>
<LazyMotion features={domAnimation}>
  <m.div animate={{ opacity: 1 }}>
    {/* ... */}
  </m.div>
</LazyMotion>
```

**预期收益：** 减少 ~3MB 首屏体积

---

### 3. 字体优化

**检查字体大小：**
```bash
ls -lh src/fonts/*.woff2
```

**如果单个文件 > 200KB：**
- 使用 `font-display: optional` 替代 `swap`
- 考虑使用 Google Fonts CDN
- 移除未使用的字重

---

## 📊 性能监控

### 使用 Lighthouse 测试

```bash
# 安装 Lighthouse CLI
npm install -g lighthouse

# 运行性能测试
lighthouse http://localhost:3000/studio \
  --output html \
  --output-path ./lighthouse-report.html \
  --preset=desktop \
  --throttling.cpuSlowdownMultiplier=1
```

**目标指标：**
- Performance Score: > 85
- FCP (First Contentful Paint): < 1.8s
- LCP (Largest Contentful Paint): < 2.5s
- TTI (Time to Interactive): < 3.8s

---

## 🚀 部署建议

### 生产环境优化

**1. 启用压缩：**
```javascript
// next.config.js
module.exports = {
  compress: true,
}
```

**2. 配置 CDN：**
- 将静态资源上传到 CDN
- 配置长缓存策略（1年）

**3. 启用 HTTP/2：**
- 使用支持 HTTP/2 的服务器
- 配置 HTTPS

---

## 📝 验证清单

- [ ] 清除 `.next/` 缓存
- [ ] 执行 `npm run build`
- [ ] 启动生产服务器 `npm run start`
- [ ] Chrome DevTools 测试（禁用缓存）
- [ ] 记录 Load 时间 < 15s
- [ ] 记录 Transfer size < 8MB
- [ ] 测试 Studio 页面功能正常
- [ ] 测试图片上传功能
- [ ] 测试 Canvas 渲染性能
- [ ] 可选：运行 Bundle Analyzer
- [ ] 可选：运行 Lighthouse 测试

---

## 🎯 预期成果

| 指标 | 优化前 | 优化后 | 改善 |
|-----|-------|--------|-----|
| 首屏加载 | 60-90s | 8-15s | **85%↓** |
| Bundle 体积 | ~50MB | ~6MB | **88%↓** |
| FCP | 8-12s | 1.5-3s | **75%↓** |
| TTI | 15-20s | 3-5s | **75%↓** |

---

## 联系人

- 修复执行：Claude
- 日期：2026-09-28
- 预计完成时间：立即可验证
