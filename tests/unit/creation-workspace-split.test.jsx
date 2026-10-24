// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import WorkspaceSplit from "../../src/components/creation/WorkspaceSplit";

let frames, nextFrame, observer, captures;
const pointer = (element, type, x, id = 1) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, { clientX: { value: x }, pointerId: { value: id }, button: { value: 0 } });
  fireEvent(element, event);
};
function tick() { act(() => { const tasks = [...frames.values()]; frames.clear(); tasks.forEach(fn => fn()); }); }
function Editor({ count }) { count(); return <main>Editor</main>; }
const view = (count = vi.fn(), userId = "u") => render(<WorkspaceSplit userId={userId} zh={false}><aside>Chat</aside><Editor count={count} /></WorkspaceSplit>);
beforeEach(() => {
  sessionStorage.clear(); frames = new Map(); nextFrame = 0; captures = new Set();
  vi.stubGlobal("requestAnimationFrame", fn => { frames.set(++nextFrame, fn); return nextFrame; });
  vi.stubGlobal("cancelAnimationFrame", id => frames.delete(id));
  vi.stubGlobal("ResizeObserver", class { constructor(fn) { observer = { notify: fn, disconnect: vi.fn() }; } observe() {} disconnect() { observer.disconnect(); } });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 1400, top: 0, left: 0 });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("supports keyboard limits, reset and per-user preference restoration", () => {
  sessionStorage.setItem("creation-chat-width:u", "410");
  const first = view(), handle = screen.getByRole("separator");
  expect(handle.getAttribute("aria-valuenow")).toBe("410");
  fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true });
  expect(handle.getAttribute("aria-valuenow")).toBe("450");
  fireEvent.keyDown(handle, { key: "End" }); expect(handle.getAttribute("aria-valuenow")).toBe("480");
  fireEvent.keyDown(handle, { key: "Home" }); expect(handle.getAttribute("aria-valuenow")).toBe("300");
  fireEvent.doubleClick(handle); expect(sessionStorage.getItem("creation-chat-width:u")).toBe("360");
  sessionStorage.setItem("creation-chat-width:u", "450"); first.unmount(); view(vi.fn(), "other");
  expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe("360");
});

it("coalesces drag frames without rerendering the editor and commits only on release", () => {
  const count = vi.fn(); view(count);
  const handle = screen.getByRole("separator"), root = handle.parentElement;
  handle.setPointerCapture = id => captures.add(id); handle.hasPointerCapture = id => captures.has(id); handle.releasePointerCapture = id => captures.delete(id);
  pointer(handle, "pointerdown", 360); pointer(handle, "pointermove", 410); pointer(handle, "pointermove", 440);
  expect(frames.size).toBe(1); expect(sessionStorage.getItem("creation-chat-width:u")).toBeNull();
  tick(); expect(root.style.getPropertyValue("--cw-chat-width")).toBe("440px");
  pointer(handle, "pointerup", 450);
  expect(sessionStorage.getItem("creation-chat-width:u")).toBe("450"); expect(count).toHaveBeenCalledOnce();
  expect(root.dataset.resizing).toBeUndefined(); expect(captures.size).toBe(0);
});

it("restores the starting width on Escape and cancels pending work on unmount", () => {
  const rendered = view(), handle = screen.getByRole("separator");
  handle.setPointerCapture = id => captures.add(id); handle.hasPointerCapture = id => captures.has(id); handle.releasePointerCapture = id => captures.delete(id);
  pointer(handle, "pointerdown", 360); pointer(handle, "pointermove", 430); tick();
  fireEvent.keyDown(handle, { key: "Escape" });
  expect(handle.getAttribute("aria-valuenow")).toBe("360"); expect(sessionStorage.getItem("creation-chat-width:u")).toBeNull();
  pointer(handle, "pointerdown", 360); pointer(handle, "pointermove", 420);
  rendered.unmount(); expect(frames.size).toBe(0); expect(observer.disconnect).toHaveBeenCalled();
});

it("clamps the panel when its available container becomes narrower", () => {
  view(); const handle = screen.getByRole("separator");
  fireEvent.keyDown(handle, { key: "End" });
  HTMLElement.prototype.getBoundingClientRect.mockReturnValue({ width: 760 });
  act(() => observer.notify());
  expect(handle.getAttribute("aria-valuemax")).toBe("400"); expect(handle.getAttribute("aria-valuenow")).toBe("400");
  HTMLElement.prototype.getBoundingClientRect.mockReturnValue({ width: 1400 });
  act(() => observer.notify()); expect(handle.getAttribute("aria-valuenow")).toBe("480");
});
