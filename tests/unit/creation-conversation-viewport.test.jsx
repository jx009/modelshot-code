// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ConversationViewport from "../../src/components/creation/ConversationViewport";

let height, total, offsets, frames, nextFrame, resize;
const scrollRef = createRef(), onLatest = vi.fn();
const body = (key, extras = {}) => <ConversationViewport scrollRef={scrollRef} changeKey={key} visibilityKey="chat" hasNewer={false} onLatest={onLatest} zh={false} {...extras}>{[1, 2, 3].map(id => <article key={id} data-message-id={`m${id}`}>Message {id}</article>)}</ConversationViewport>;
const region = () => screen.getByRole("region", { name: "Creation messages" });
const tick = () => act(() => { const tasks = [...frames.values()]; frames.clear(); tasks.forEach(fn => fn()); });
beforeEach(() => {
  height = 400; total = 1000; offsets = { m1: 0, m2: 100, m3: 200 }; frames = new Map(); nextFrame = 0; onLatest.mockReset();
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function () { return this.classList.contains("cw-messages") ? height : 0; });
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function () { return this.classList.contains("cw-messages") ? total : 0; });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
    const top = this.dataset.messageId ? offsets[this.dataset.messageId] - this.closest(".cw-messages").scrollTop : 0;
    return { top, bottom: top + 100 };
  });
  vi.stubGlobal("requestAnimationFrame", fn => { frames.set(++nextFrame, fn); return nextFrame; });
  vi.stubGlobal("cancelAnimationFrame", id => frames.delete(id));
  vi.stubGlobal("ResizeObserver", class { constructor(fn) { resize = { notify: fn, disconnect: vi.fn() }; } observe() {} disconnect() { resize.disconnect(); } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("follows new content at the bottom but preserves reading position after scrolling away", () => {
  const rendered = render(body(1));
  expect(region().scrollTop).toBe(600);
  total = 1100; rendered.rerender(body(2)); expect(region().scrollTop).toBe(700);
  region().scrollTop = 150; fireEvent.scroll(region());
  total = 1300; rendered.rerender(body(3)); expect(region().scrollTop).toBe(150);
  fireEvent.click(screen.getByText("View latest messages"));
  expect(region().scrollTop).toBe(900); expect(onLatest).not.toHaveBeenCalled();
});

it("restores the same visible message offset after older messages are prepended", () => {
  const rendered = render(body(1)); region().scrollTop = 150; fireEvent.scroll(region());
  act(() => scrollRef.current.preserveHistory());
  offsets = { m1: 100, m2: 200, m3: 300 }; total = 1100;
  rendered.rerender(body(2));
  expect(region().scrollTop).toBe(250);
  expect(region().querySelector('[data-message-id="m2"]').getBoundingClientRect().top).toBe(-50);
});

it("requests the newest page explicitly when the history window has newer messages outside it", () => {
  render(body(1, { hasNewer: true }));
  region().scrollTop = 100; fireEvent.scroll(region());
  fireEvent.click(screen.getByText("View latest messages"));
  expect(onLatest).toHaveBeenCalledOnce(); expect(region().scrollTop).toBe(100);
  act(() => scrollRef.current.followLatest()); expect(region().scrollTop).toBe(600);
});

it("coalesces content resizes, stops following while reading, and cancels pending frames on unmount", () => {
  const rendered = render(body(1));
  total = 1200; act(() => { resize.notify(); resize.notify(); });
  expect(frames.size).toBe(1); tick(); expect(region().scrollTop).toBe(800);
  region().scrollTop = 10; fireEvent.scroll(region()); act(() => resize.notify()); expect(frames.size).toBe(0);
  act(() => scrollRef.current.followLatest()); act(() => resize.notify());
  rendered.unmount(); expect(frames.size).toBe(0); expect(resize.disconnect).toHaveBeenCalledOnce();
});

it("does not move a hidden panel and follows the latest content when it becomes visible", () => {
  height = 0; const rendered = render(body(1)); expect(region().scrollTop).toBe(0);
  total = 1200; height = 400;
  rendered.rerender(body(1, { visibilityKey: "artwork" })); expect(region().scrollTop).toBe(800);
});
