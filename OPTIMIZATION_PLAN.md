# ModelShot 优化实施方案

## 优先级 P0：核心架构重构（1-2周）

### 1. StudioCanvas 组件重构

**当前问题**：325行代码混合了太多职责，14+ useState，状态管理混乱

**重构方案**：

#### 1.1 创建自定义 hooks 拆分状态逻辑

```javascript
// src/components/studio/canvas/hooks/useCanvasState.js
export function useCanvasState() {
  const [camera, setCamera] = useState({ x: 30, y: 20, scale: 1 });
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  
  const zoom = useCallback((factor) => {
    setCamera(c => {
      const scale = Math.min(4, Math.max(0.08, c.scale * factor));
      const center = { x: dimensions.width / 2, y: dimensions.height / 2 };
      return {
        scale,
        x: center.x - (center.x - c.x) / c.scale * scale,
        y: center.y - (center.y - c.y) / c.scale * scale
      };
    });
  }, [dimensions]);
  
  const fit = useCallback((layers) => {
    const visible = layers.filter(l => l.visible);
    if (!visible.length) {
      setCamera({ x: 30, y: 20, scale: 1 });
      return;
    }
    // ... fit 逻辑
  }, [dimensions]);
  
  return { camera, dimensions, setCamera, setDimensions, zoom, fit };
}

// src/components/studio/canvas/hooks/useDrawingState.js
export function useDrawingState() {
  const [strokes, setStrokes] = useState([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const activeStroke = useRef(null);
  
  const startStroke = useCallback((point, target, width) => {
    activeStroke.current = {
      target,
      width,
      points: [point.x, point.y],
      id: Date.now()
    };
    setIsDrawing(true);
  }, []);
  
  const addPoint = useCallback((point) => {
    if (!activeStroke.current) return;
    activeStroke.current.points.push(point.x, point.y);
    // 使用 throttle 优化性能
  }, []);
  
  const endStroke = useCallback(() => {
    if (activeStroke.current) {
      setStrokes(prev => [...prev, activeStroke.current]);
      activeStroke.current = null;
    }
    setIsDrawing(false);
  }, []);
  
  const clearStrokes = useCallback((targetId) => {
    setStrokes(prev => prev.filter(s => s.target !== targetId));
  }, []);
  
  return { strokes, isDrawing, startStroke, addPoint, endStroke, clearStrokes };
}

// src/components/studio/canvas/hooks/useSelectionState.js
export function useSelectionState() {
  const [movePreview, setMovePreview] = useState(null);
  const [moveSelection, setMoveSelection] = useState(null);
  const [crop, setCrop] = useState(null);
  
  // ... 选区相关逻辑
  
  return { movePreview, moveSelection, crop, /* ... */ };
}
```

#### 1.2 按模式拆分交互组件

```javascript
// src/components/studio/canvas/modes/BrushMode.jsx
export function BrushMode({ 
  selectedLayer, 
  brushSize, 
  camera, 
  onStrokeStart, 
  onStrokeMove, 
  onStrokeEnd 
}) {
  const stageRef = useRef(null);
  
  const handlePointerDown = (e) => {
    const pos = e.target.getStage().getPointerPosition();
    const worldPos = screenToWorld(pos, camera);
    onStrokeStart(worldPos);
  };
  
  // ... 笔刷绘制逻辑
  
  return (
    <Layer>
      {/* 笔刷笔画渲染 */}
    </Layer>
  );
}

// src/components/studio/canvas/modes/CropMode.jsx
export function CropMode({ image, cropRect, onCropChange }) {
  // ... 裁剪逻辑
}

// src/components/studio/canvas/modes/MoveMode.jsx
export function MoveMode({ 
  selectedLayer, 
  segmentProvider, 
  onPreviewReady, 
  onMoveFailed 
}) {
  // ... 物体移动逻辑
}
```

#### 1.3 重构后的 StudioCanvas 主文件

```javascript
// src/components/studio/canvas/StudioCanvas.jsx (目标：150行以内)
import { useCanvasState } from './hooks/useCanvasState';
import { useDrawingState } from './hooks/useDrawingState';
import { useSelectionState } from './hooks/useSelectionState';
import { BrushMode } from './modes/BrushMode';
import { CropMode } from './modes/CropMode';
import { MoveMode } from './modes/MoveMode';

const StudioCanvas = forwardRef(function StudioCanvas({
  layers,
  selectedId,
  mode,
  // ... props
}, ref) {
  const container = useRef(null);
  const { camera, dimensions, zoom, fit } = useCanvasState();
  const drawing = useDrawingState();
  const selection = useSelectionState();
  
  // 暴露给父组件的方法
  useImperativeHandle(ref, () => ({
    zoom,
    fit,
    exportPNG: async () => { /* ... */ },
    maskBlob: async () => { /* ... */ },
    clearMask: () => drawing.clearStrokes(`${selectedId}:mask`)
  }));
  
  return (
    <div ref={container} className="ms-canvas-space">
      <Stage
        width={dimensions.width}
        height={dimensions.height}
        scaleX={camera.scale}
        scaleY={camera.scale}
        x={camera.x}
        y={camera.y}
      >
        <Layer>
          {layers.map(layer => (
            <Picture
              key={layer.id}
              item={layer}
              selected={layer.id === selectedId}
              onSelect={() => onSelect(layer.id)}
            />
          ))}
        </Layer>
        
        {mode === 'brush' && <BrushMode {...drawing} />}
        {mode === 'crop' && <CropMode {...selection} />}
        {mode === 'move' && <MoveMode {...selection} />}
      </Stage>
    </div>
  );
});
```

**预期效果**：
- 主文件减少到 150 行左右
- 每个 hook 单独测试
- 模式切换更清晰
- 状态隔离，减少意外副作用

---

### 2. 性能优化

#### 2.1 画笔绘制节流

```javascript
// src/lib/utils/throttle.js
export function throttleRaf(fn) {
  let rafId = null;
  let lastArgs = null;
  
  return function throttled(...args) {
    lastArgs = args;
    if (rafId === null) {
      rafId = requestAnimationFrame(() => {
        fn.apply(this, lastArgs);
        rafId = null;
      });
    }
  };
}

// 在 useDrawingState 中使用
const addPointThrottled = useMemo(
  () => throttleRaf(addPoint),
  [addPoint]
);
```

#### 2.2 大图处理优化

```javascript
// src/lib/studio/image-processor.js
export async function processLargeImage(image, maxDimension = 2048) {
  if (image.width <= maxDimension && image.height <= maxDimension) {
    return image;
  }
  
  const scale = maxDimension / Math.max(image.width, image.height);
  const canvas = document.createElement('canvas');
  canvas.width = image.width * scale;
  canvas.height = image.height * scale;
  
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  
  return new Promise(resolve => {
    canvas.toBlob(blob => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.src = URL.createObjectURL(blob);
    });
  });
}
```

#### 2.3 Konva Layer 优化

```javascript
// 使用 FastLayer 加速非交互层
import { FastLayer } from 'react-konva';

<FastLayer listening={false}>
  {/* 背景图层 */}
</FastLayer>
```

---

### 3. 移动端体验修复

#### 3.1 工具栏字体调整

```css
/* src/components/studio/studio.css */
@media(max-width:760px){
  .ms-context-scroll>button,
  .ms-context-scroll>a {
    font-size: 10px;  /* 从 8px 提升到 10px */
    min-width: 62px;  /* 从 55px 增加到 62px */
    padding: 9px 7px; /* 增加内边距 */
  }
  
  .ms-icon {
    width: 36px;   /* 从 32px 增加 */
    height: 36px;
  }
}
```

#### 3.2 画中画预览模式

```javascript
// src/components/studio/MobilePiPCanvas.jsx
export function MobilePiPCanvas({ isVisible, onClose, layers }) {
  if (!isVisible) return null;
  
  return (
    <div className="fixed bottom-20 right-4 w-32 h-24 rounded-lg overflow-hidden border-2 border-primary shadow-xl z-50">
      <Stage width={128} height={96} scaleX={0.1} scaleY={0.1}>
        <Layer>
          {layers.map(layer => (
            <Picture key={layer.id} item={layer} interactive={false} />
          ))}
        </Layer>
      </Stage>
      <button
        onClick={onClose}
        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-xs"
      >
        ×
      </button>
    </div>
  );
}
```

---

## 优先级 P1：视觉艺术感提升（1-2周）

### 4. 色彩系统优化

#### 4.1 引入渐变系统

```css
/* src/app/globals.css - 在原有基础上增加 */
:root {
  /* 渐变定义 */
  --gradient-primary: linear-gradient(135deg, #D9F154 0%, #B8D943 100%);
  --gradient-accent: linear-gradient(180deg, #D9F154 0%, #C8E03F 100%);
  --gradient-glow: radial-gradient(circle at 30% 30%, rgba(217, 241, 84, 0.18), transparent 70%);
  
  /* 辅助色 */
  --accent-warm: #EF9F27;     /* 琥珀色 - 用于成功/完成状态 */
  --accent-cool: #4A9FDC;     /* 深青色 - 用于技术操作 */
  --accent-coral: #FF8B7B;    /* 珊瑚橙 - 用于创意强调 */
  
  /* 艺术化阴影 */
  --shadow-artwork: 0 8px 32px rgba(217, 241, 84, 0.12),
                    0 2px 8px rgba(0, 0, 0, 0.24);
  --shadow-elevated: 0 16px 48px rgba(0, 0, 0, 0.3),
                     0 4px 12px rgba(217, 241, 84, 0.08);
}

[data-theme="light"] {
  --gradient-primary: linear-gradient(135deg, #7A8F1C 0%, #697F17 100%);
  --shadow-artwork: 0 8px 32px rgba(122, 143, 28, 0.12),
                    0 2px 8px rgba(0, 0, 0, 0.12);
}
```

#### 4.2 应用渐变到关键元素

```css
/* 主按钮渐变 */
.ms-button.ms-primary {
  background: var(--gradient-primary);
  position: relative;
  overflow: hidden;
}

/* 按钮高光效果 */
.ms-button.ms-primary::before {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
  transition: left 0.5s;
}

.ms-button.ms-primary:hover::before {
  left: 100%;
}

/* 品牌标志渐变 */
.ms-brand span {
  background: var(--gradient-primary);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* 画布周围环境光 */
.ms-canvas-space::before {
  content: '';
  position: absolute;
  inset: -80px;
  background: var(--gradient-glow);
  opacity: 0.4;
  pointer-events: none;
  z-index: 0;
}
```

#### 4.3 状态色彩系统

```css
/* 生成中 - 酸性黄绿脉动 */
.ms-generating {
  animation: generating-pulse 2s ease-in-out infinite;
}

@keyframes generating-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(217, 241, 84, 0.4); }
  50% { box-shadow: 0 0 0 12px rgba(217, 241, 84, 0); }
}

/* 完成 - 琥珀色光晕 */
.ms-completed {
  box-shadow: 0 0 24px rgba(239, 159, 39, 0.5);
  border-color: var(--accent-warm);
}

/* 错误 - 保持原有 danger 色 */
.ms-failed {
  box-shadow: 0 0 16px rgba(240, 105, 90, 0.4);
}
```

---

### 5. 动画细节增强

#### 5.1 工具切换动画

```css
/* 光圈收缩动画 */
@keyframes aperture-open {
  0% {
    transform: scale(0.3) rotate(45deg);
    opacity: 0;
  }
  60% {
    transform: scale(1.1) rotate(0deg);
  }
  100% {
    transform: scale(1) rotate(0deg);
    opacity: 1;
  }
}

.ms-tool-enter {
  animation: aperture-open 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* 工具图标激活时的闪光 */
.ms-icon.active::after {
  content: '';
  position: absolute;
  inset: -2px;
  border-radius: inherit;
  background: var(--gradient-accent);
  opacity: 0;
  animation: flash-once 0.6s ease-out;
}

@keyframes flash-once {
  0% { opacity: 0; transform: scale(0.8); }
  30% { opacity: 0.6; transform: scale(1.2); }
  100% { opacity: 0; transform: scale(1.4); }
}
```

#### 5.2 图层操作反馈

```javascript
// src/components/studio/canvas/animations/layerFeedback.js
export function animateLayerDelete(layerNode) {
  return new Promise(resolve => {
    layerNode.to({
      opacity: 0,
      scaleX: 0.3,
      scaleY: 0.3,
      rotation: 360,
      duration: 0.4,
      easing: Konva.Easings.EaseOut,
      onFinish: resolve
    });
  });
}

export function animateLayerAdd(layerNode) {
  layerNode.opacity(0);
  layerNode.scale({ x: 0.5, y: 0.5 });
  layerNode.to({
    opacity: 1,
    scaleX: 1,
    scaleY: 1,
    duration: 0.5,
    easing: Konva.Easings.BackEaseOut
  });
}
```

#### 5.3 生成过程扫描线

```css
/* 增强现有的 scanLine 动画 */
@keyframes scanLine {
  0% {
    transform: translateY(-100%);
    opacity: 0;
  }
  10% {
    opacity: 0.6;
  }
  90% {
    opacity: 0.6;
  }
  100% {
    transform: translateY(100%);
    opacity: 0;
  }
}

.ms-generating-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

.ms-generating-overlay::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, 
    transparent, 
    var(--primary), 
    transparent
  );
  box-shadow: 0 0 12px var(--primary);
  animation: scanLine 3s ease-in-out infinite;
}
```

---

### 6. 排版系统优化

#### 6.1 中文字体引入

```css
/* src/app/globals.css */
@font-face {
  font-family: 'LXGW WenKai';
  src: url('/fonts/LXGWWenKai-Regular.woff2') format('woff2');
  font-weight: 400;
  font-display: swap;
}

@font-face {
  font-family: 'Source Han Serif';
  src: url('/fonts/SourceHanSerifCN-Regular.woff2') format('woff2');
  font-weight: 400;
  font-display: swap;
}

:root {
  --font-zh-art: 'LXGW WenKai', 'Source Han Serif', serif;
}

/* 应用到艺术性标题 */
.ms-welcome h1,
.ms-empty-canvas h2 {
  font-family: var(--font-instrument), var(--font-zh-art), serif;
}
```

#### 6.2 响应式字阶

```css
/* 使用 clamp 实现流式排版 */
.ms-welcome h1 {
  font-size: clamp(18px, 4vw, 24px);
  line-height: 1.6;
  letter-spacing: -0.03em;
}

.ms-brand span {
  font-size: clamp(18px, 3.5vw, 21px);
}

/* 移动端优化 */
@media(max-width:760px){
  .ms-message p {
    font-size: clamp(12px, 3.5vw, 14px);
    line-height: 1.9;
  }
}
```

---

### 7. 交互细节

#### 7.1 自定义光标

```javascript
// public/cursors/brush-cursor.svg
<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <circle cx="16" cy="16" r="14" fill="none" stroke="#D9F154" stroke-width="2" opacity="0.6"/>
  <circle cx="16" cy="16" r="2" fill="#D9F154"/>
</svg>

// 动态生成带尺寸的光标
// src/lib/studio/cursor-generator.js
export function generateBrushCursor(size, color = '#D9F154') {
  const svg = `
    <svg width="${size * 2}" height="${size * 2}" viewBox="0 0 ${size * 2} ${size * 2}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${size}" cy="${size}" r="${size - 2}" fill="none" stroke="${color}" stroke-width="2" opacity="0.6"/>
      <circle cx="${size}" cy="${size}" r="2" fill="${color}"/>
    </svg>
  `;
  const encoded = encodeURIComponent(svg);
  return `url('data:image/svg+xml;utf8,${encoded}') ${size} ${size}, crosshair`;
}

// 在 StudioCanvas 中应用
useEffect(() => {
  if (mode === 'brush' && container.current) {
    container.current.style.cursor = generateBrushCursor(brushSize);
  }
}, [mode, brushSize]);
```

```css
/* 其他工具光标 */
.ms-stage.is-hand {
  cursor: grab;
}

.ms-stage.is-hand:active {
  cursor: grabbing;
}

.ms-stage.is-crop {
  cursor: crosshair;
}

.ms-stage.is-move {
  cursor: move;
}
```

#### 7.2 空状态插画优化

```jsx
// src/components/studio/EmptyCanvasIllustration.jsx
export function EmptyCanvasIllustration() {
  return (
    <div className="relative w-72 h-52 mx-auto">
      {/* 底部阴影 */}
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-64 h-4 bg-gradient-radial from-black/20 to-transparent rounded-full blur-sm" />
      
      {/* 后景框 */}
      <motion.div
        initial={{ rotate: -18, opacity: 0, scale: 0.8 }}
        animate={{ rotate: -12, opacity: 0.6, scale: 1 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="absolute left-2 top-2 w-40 h-44 rounded-xl border-2 border-divider-strong bg-bg-elevated p-2 shadow-lg"
      >
        <div className="w-full h-full rounded-lg bg-gradient-to-br from-bg-page to-bg-card" />
      </motion.div>
      
      {/* 前景框 */}
      <motion.div
        initial={{ rotate: 12, opacity: 0, scale: 0.8 }}
        animate={{ rotate: 8, opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, delay: 0.1, ease: "easeOut" }}
        className="absolute right-1 top-6 w-44 h-48 rounded-xl border-2 border-primary/40 bg-bg-elevated p-2 shadow-artwork"
      >
        <div className="relative w-full h-full rounded-lg bg-gradient-to-br from-primary-muted to-bg-card overflow-hidden">
          {/* AI图标 */}
          <Sparkles className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-primary" size={32} strokeWidth={1.5} />
        </div>
        
        {/* 标签 */}
        <div className="absolute bottom-3 left-3 right-3 px-2 py-1.5 rounded-md bg-glass-bg backdrop-blur-md border border-glass-border flex items-center justify-center gap-1.5">
          <Aperture size={12} className="text-primary" />
          <span className="text-[9px] text-primary-text font-medium">AI READY</span>
        </div>
      </motion.div>
      
      {/* 装饰性十字 */}
      <motion.span
        initial={{ opacity: 0, scale: 0 }}
        animate={{ opacity: 0.4, scale: 1, rotate: 360 }}
        transition={{ duration: 0.8, delay: 0.3 }}
        className="absolute -top-3 right-12 text-2xl font-light text-primary"
      >
        +
      </motion.span>
      
      <motion.span
        initial={{ opacity: 0, scale: 0 }}
        animate={{ opacity: 0.25, scale: 1, rotate: -360 }}
        transition={{ duration: 0.8, delay: 0.4 }}
        className="absolute -left-4 bottom-2 text-lg font-light text-primary"
      >
        +
      </motion.span>
    </div>
  );
}
```

---

## 优先级 P2：高级特性（1个月）

### 8. 动态配色系统

```javascript
// src/lib/studio/color-extraction.js
import { extractColors } from 'extract-colors';

export async function extractDominantColors(imageUrl) {
  const colors = await extractColors(imageUrl, {
    pixels: 64000,
    distance: 0.22,
    splitPower: 10,
    colorValidator: (red, green, blue, alpha = 255) => alpha > 250
  });
  
  return colors
    .sort((a, b) => b.area - a.area)
    .slice(0, 3)
    .map(c => c.hex);
}

// src/components/studio/StudioWorkbench.jsx
const [accentColors, setAccentColors] = useState([]);

useEffect(() => {
  if (selected?.assetId) {
    extractDominantColors(`/api/assets/${selected.assetId}`)
      .then(colors => setAccentColors(colors))
      .catch(() => setAccentColors([]));
  }
}, [selected?.assetId]);

// 应用到界面
<div style={{
  '--extracted-accent': accentColors[0] || 'var(--primary)'
}}>
  {/* 界面元素会使用 var(--extracted-accent) */}
</div>
```

### 9. 3D 视觉效果（可选）

```css
/* 画布容器透视效果 */
.ms-canvas-space {
  perspective: 1200px;
}

.ms-stage {
  transform-style: preserve-3d;
  transition: transform 0.3s ease;
}

/* 鼠标悬停时轻微倾斜 */
.ms-canvas-space:hover .ms-stage {
  transform: rotateX(1deg) rotateY(2deg);
}

/* 图层卡片3D效果 */
.ms-layer {
  transform: translateZ(0);
  transition: transform 0.2s ease;
}

.ms-layer.selected {
  transform: translateZ(8px);
  box-shadow: 0 8px 24px rgba(0,0,0,0.3);
}
```

### 10. 音效反馈（可选）

```javascript
// src/lib/audio/soundEffects.js
const sounds = {
  toolSwitch: new Audio('/sounds/tool-switch.mp3'),
  layerAdd: new Audio('/sounds/layer-add.mp3'),
  export: new Audio('/sounds/export.mp3'),
  complete: new Audio('/sounds/complete.mp3')
};

// 音量控制
Object.values(sounds).forEach(sound => {
  sound.volume = 0.3;
});

export function playSound(name) {
  if (sounds[name] && localStorage.getItem('soundEnabled') !== 'false') {
    sounds[name].currentTime = 0;
    sounds[name].play().catch(() => {});
  }
}

// 使用
import { playSound } from '@/lib/audio/soundEffects';

function chooseTool(toolId) {
  setTool(toolId);
  playSound('toolSwitch');
}
```

---

## 实施时间线

### 第1周
- ✅ StudioCanvas 重构（hooks拆分）
- ✅ 性能优化（节流、大图处理）
- ✅ 移动端字体修复

### 第2周
- ✅ 色彩系统优化（渐变、辅助色）
- ✅ 动画细节增强
- ✅ 空状态插画优化

### 第3周
- ✅ 排版系统（中文字体）
- ✅ 自定义光标
- ✅ 状态色彩系统

### 第4周
- ⚙️ 动态配色系统
- ⚙️ 3D视觉效果
- ⚙️ 音效反馈（可选）

---

## 验收标准

### 代码质量
- [ ] StudioCanvas < 200 行
- [ ] 单个函数 < 50 行
- [ ] 每个 hook 有单元测试
- [ ] ESLint 0 warnings

### 性能
- [ ] 画笔绘制 60fps
- [ ] 大图(>4K) 加载时间 < 2s
- [ ] 首屏渲染 < 1.5s (3G网络)

### 移动端
- [ ] 工具栏可用性测试通过
- [ ] 触摸操作无误触
- [ ] 画中画模式正常工作

### 视觉
- [ ] 色彩对比度 >= WCAG AA
- [ ] 动画流畅度 >= 60fps
- [ ] 暗黑/明亮主题一致性
- [ ] 中文排版无破碎

---

## 后续优化方向

1. **无障碍增强**
   - 键盘导航完整支持
   - 屏幕阅读器优化
   - 高对比度模式

2. **协作功能**
   - 实时协作光标
   - 评论标注系统
   - 版本历史可视化

3. **AI 交互优化**
   - 语音输入支持
   - 手势识别创作
   - 智能构图建议

4. **性能监控**
   - Sentry 错误追踪
   - Web Vitals 监控
   - 用户行为热图
