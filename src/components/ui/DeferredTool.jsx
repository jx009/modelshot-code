"use client";

import { Component, Suspense } from "react";
import { useLocale } from "next-intl";
import Modal from "./Modal";
import BrandLoader from "./BrandLoader";

export function ToolLoading() {
  const zh = useLocale() === "zh";
  return <BrandLoader variant="inline" label={zh ? "正在加载工具" : "Loading tool"} />;
}

function ToolFallback({ label, onClose, failed = false }) {
  const zh = useLocale() === "zh";
  return <Modal label={label} onClose={onClose}>
    <h2>{label}</h2>
    {failed ? <p role="alert">{zh ? "工具加载失败，请保留当前项目，稍后重新加载页面。" : "The tool could not load. Keep your project and reload the page later."}</p> : <ToolLoading />}
    <button type="button" className="button" onClick={onClose}>{zh ? "关闭" : "Close"}</button>
  </Modal>;
}

export default class DeferredTool extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    const { children, label, onClose } = this.props;
    if (this.state.failed) return <ToolFallback label={label} onClose={onClose} failed />;
    return <Suspense fallback={<ToolFallback label={label} onClose={onClose} />}>{children}</Suspense>;
  }
}
