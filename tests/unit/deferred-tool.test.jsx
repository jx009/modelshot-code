// @vitest-environment jsdom
import { lazy, useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import DeferredTool from "../../src/components/ui/DeferredTool.jsx";

vi.mock("next-intl", () => ({ useLocale: () => "zh" }));
vi.mock("@/components/ui/Modal", () => ({ default: ({ children, label }) => <section role="dialog" aria-label={label}>{children}</section> }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("opens a closeable loading dialog before the tool module arrives", async () => {
  let resolve;
  const Tool = lazy(() => new Promise(done => { resolve = done; }));
  const close = vi.fn();
  const view = render(<DeferredTool label="导出作品" onClose={close}><Tool /></DeferredTool>);
  expect(screen.getByRole("dialog", { name: "导出作品" })).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("正在加载工具");
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  expect(close).toHaveBeenCalledOnce();
  await act(async () => resolve({ default: () => <section role="dialog" aria-label="导出作品">导出选项</section> }));
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(screen.queryByRole("status")).toBeNull();
  view.unmount();
});

it("does not reopen a tool after the user closes its loading window", async () => {
  let resolve;
  const Tool = lazy(() => new Promise(done => { resolve = done; }));
  function Host() {
    const [open, setOpen] = useState(true);
    return open && <DeferredTool label="图片预览" onClose={() => setOpen(false)}><Tool /></DeferredTool>;
  }
  render(<Host />);
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  await act(async () => resolve({ default: () => <p>图片</p> }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText("图片")).toBeNull();
});

it("shows an actionable failure instead of leaving the loading dialog stuck", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const Tool = lazy(() => Promise.reject(new Error("Chunk load failed")));
  const close = vi.fn();
  await act(async () => { render(<DeferredTool label="导出作品" onClose={close}><Tool /></DeferredTool>); });
  expect(screen.getByRole("alert").textContent).toContain("工具加载失败");
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  expect(close).toHaveBeenCalledOnce();
});
