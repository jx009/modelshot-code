"use client";

import { useLayoutEffect, useRef } from "react";

// Resize only this field; typing never serializes a document or updates layout state.
export default function AutoGrowTextarea({ value, ...props }) {
  const input = useRef(null);
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    const resize = () => {
      if (!element.clientWidth) return;
      element.style.height = "0px";
      element.style.height = `${element.scrollHeight}px`;
    };
    resize();
    let width = element.clientWidth;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth; resize();
    });
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [value]);
  return <textarea {...props} ref={input} rows={2} value={value} />;
}
