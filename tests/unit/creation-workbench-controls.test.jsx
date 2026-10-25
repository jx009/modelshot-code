// @vitest-environment jsdom
import { cleanup, fireEvent, render, renderHook, screen, act } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import CreationTaskStatus, { RunStatusStrip, taskTitle } from "../../src/components/creation/CreationTaskStatus";
import { MessageText } from "../../src/components/creation/CreationMessage";
import { useSlideReorder, slideDropIndex } from "../../src/components/creation/useSlideReorder";
import { reconcileArtwork } from "../../src/lib/creation/client/reconcile-artwork";
import { slidePublishedMessage, slideCompletionMessage } from "../../src/lib/creation/slide-publication-message";
import { artifactResources } from "../../src/lib/creation/client/artifact-resources";

afterEach(cleanup);
it("lists only actual stored images and design notes, deduplicating shared images", () => {
  const content = { schemaVersion: 3, pages: [{ title: "Cover", html: '<img src="asset:cover_1">' }, { title: "End", html: '<img src="asset:cover_1"><img src="asset:end_2">' }], metadata: { designMarkdown: "# Direction" } };
  expect(artifactResources("deck", content)).toEqual({ artifactId: "deck", images: [{ id: "cover_1", pageTitle: "Cover" }, { id: "end_2", pageTitle: "End" }], design: "# Direction" });
  expect(artifactResources("legacy", { schemaVersion: 2 })).toEqual({ artifactId: "legacy", images: [], design: "" });
  expect(artifactResources("text-only", { schemaVersion: 3, pages: [{ html: "<p>Example asset:example_id</p>" }] }).images).toEqual([]);
});
const pages = ["a", "b", "c", "d"].map(id => ({ id, title: id }));
it("moves upward and downward without a drop-boundary off-by-one", () => {
  expect(slideDropIndex(pages, "a", "c", true)).toBe(2);
  expect(slideDropIndex(pages, "a", "c", false)).toBe(1);
  expect(slideDropIndex(pages, "d", "b", false)).toBe(1);
  expect(slideDropIndex(pages, "d", "d", true)).toBe(3);
  expect(slideDropIndex(pages, "missing", "b", true)).toBe(-1);
});
it("supports keyboard reordering and blocks read-only changes", () => {
  const onMove = vi.fn();
  const { result, rerender } = renderHook(({ readOnly }) => useSlideReorder({ pages, readOnly, onMove }), { initialProps: { readOnly: false } });
  const event = { altKey: true, key: "ArrowDown", preventDefault: vi.fn() };
  act(() => result.current.handleProps("b").onKeyDown(event));
  expect(onMove).toHaveBeenCalledWith("b", 2);
  rerender({ readOnly: true });
  act(() => result.current.handleProps("b").onKeyDown(event));
  expect(onMove).toHaveBeenCalledTimes(1);
});
it("commits a native drop once and clears the drag guard", () => {
  const onMove = vi.fn();
  function List() {
    const { root, rowProps } = useSlideReorder({ pages, onMove });
    return <div ref={root}>{pages.map(page => <div key={page.id} {...rowProps(page.id)}>{page.title}</div>)}</div>;
  }
  render(<List />);
  const dataTransfer = { setData: vi.fn() };
  const source = screen.getByText("a"), target = screen.getByText("c");
  target.getBoundingClientRect = () => ({ top: 10, height: 100 });
  const dragEvent = (element, type) => fireEvent(element, Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true, clientY: 100 }), { dataTransfer }));
  dragEvent(source, "dragstart");
  dragEvent(target, "dragover");
  dragEvent(target, "drop");
  fireEvent.dragEnd(source);
  expect(onMove).toHaveBeenCalledExactlyOnceWith("a", 2);
  dragEvent(target, "drop");
  expect(onMove).toHaveBeenCalledOnce();
});
it("preserves unchanged page and theme identities when appending generated pages", () => {
  const current = { schemaVersion: 3, pages: [{ id: "a", html: "a" }, { id: "b", html: "b" }], theme: { accent: "teal" } };
  const incoming = structuredClone(current); incoming.pages[1].html = "changed"; incoming.pages.push({ id: "c", html: "c" });
  const next = reconcileArtwork(current, incoming);
  expect(next.pages[0]).toBe(current.pages[0]); expect(next.theme).toBe(current.theme);
  expect(next.pages[1]).not.toBe(current.pages[1]); expect(next.pages).toHaveLength(3);
});
const run = { id: "run", kind: "slides", status: "failed", committedCredits: 3, maxCredits: 20, errorCode: "LANGUAGE_PROVIDER_GATEWAY_TIMEOUT", steps: [
  { id: "one", tool: "slides.page", explanation: "Cover", position: 0, status: "succeeded", result: { artifactId: "deck" } },
  { id: "two", tool: "slides.page", explanation: "Results", position: 1, status: "failed", errorCode: "LANGUAGE_PROVIDER_GATEWAY_TIMEOUT" },
  { id: "three", tool: "layout.assemble", explanation: "Assemble", position: 2, status: "blocked" },
] };
it("makes failure explicit while preserving completed pages and exposes only user-triggered retry", () => {
  const retry = vi.fn();
  render(<CreationTaskStatus run={run} expanded zh onResume={retry} />);
  expect(screen.getByText("部分步骤失败 · 已停止")).toBeTruthy();
  expect(screen.getByText("尚未执行")).toBeTruthy();
  expect(screen.queryByText("等待前序步骤")).toBeNull();
  expect(screen.getAllByText(/504\/524/).length).toBeGreaterThan(0);
  expect(retry).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("重试失败步骤")); expect(retry).toHaveBeenCalledOnce();
});
it("keeps active state visible outside the conversation and distinguishes partial failures", () => {
  const running = { ...run, status: "running", steps: [...run.steps, { id: "four", status: "running", explanation: "Chart" }] };
  render(<RunStatusStrip run={running} zh onDetails={() => {}} />);
  expect(screen.getByText("继续生成中 · 部分步骤失败")).toBeTruthy();
  expect(screen.getByText("已保存 1/2 页")).toBeTruthy();
  expect(taskTitle({ ...run, status: "succeeded" })).toBe("全部完成");
});
it("renders message hierarchy as safe text without executing model HTML", () => {
  const view = render(<MessageText value={'**视觉风格**\n\n- 简洁\n- 留白\n\n<script>alert(1)</script>'} />);
  expect(view.container.querySelector("strong").textContent).toBe("视觉风格");
  expect(view.container.querySelectorAll("li")).toHaveLength(2);
  expect(view.container.querySelector("script")).toBeNull();
});
it("describes generated pages as generation and supplies a factual final handoff", () => {
  const outline = { title: "Launch", pages: [{ id: "a", title: "Cover" }, { id: "b", title: "Results", role: "Evidence" }], design: { artDirection: "Teal" } };
  expect(slidePublishedMessage(outline, "b")).toContain("第 2/2 页");
  expect(slidePublishedMessage(outline, "b")).not.toContain("修改选定");
  expect(slideCompletionMessage(outline)).toContain("全部已保存");
  expect(slideCompletionMessage(outline)).toContain("Teal");
});
