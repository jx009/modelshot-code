import { useCallback, useEffect, useRef } from "react";

// 聚光灯跟随指针：直接写 CSS 变量，不触发 React 重渲染。
// 只在首屏可见时监听一次，指针离开或首屏滚出视图后淡出。
export function useHeroPointer() {
  const ref = useRef(null);
  const frame = useRef(0);
  const point = useRef({ x: 0, y: 0 });

  const paint = useCallback(() => {
    frame.current = 0;
    const node = ref.current;
    if (!node) return;
    node.style.setProperty("--lh-mx", `${point.current.x}px`);
    node.style.setProperty("--lh-my", `${point.current.y}px`);
    node.style.setProperty("--lh-lit", "1");
  }, []);

  const onPointerMove = useCallback(event => {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    point.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (!frame.current) frame.current = requestAnimationFrame(paint);
  }, [paint]);

  const onPointerLeave = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    ref.current?.style.setProperty("--lh-lit", "0");
  }, []);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  return { ref, onPointerMove, onPointerLeave };
}
