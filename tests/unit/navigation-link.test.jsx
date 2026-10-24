// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import NavigationLink from "../../src/components/ui/NavigationLink.jsx";
import NavigationFeedback, { useNavigationFeedback } from "../../src/components/ui/NavigationFeedback.jsx";
import NavigationContent from "../../src/components/ui/NavigationContent.jsx";
import { useEffect, useRef, useState } from "react";
import { registerNavigationGuard } from "../../src/lib/navigation-guard.js";
import { LocalNavigationContext } from "../../src/components/ui/LocalNavigation.jsx";

const state = vi.hoisted(() => ({ pending: false, prefetch: null, skipNavigate: false, push: vi.fn(), replace: vi.fn() }));
vi.mock("next/link", () => ({ useLinkStatus: () => ({ pending: state.pending }) }));
vi.mock("next-intl", () => ({ useLocale: () => "zh" }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => null }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: state.push, replace: state.replace }), Link: ({ children, prefetch, onNavigate, onClick, ...props }) => { state.prefetch = prefetch; return <a {...props} onClick={event => {
  onClick?.(event);
  if (!state.skipNavigate && !event.defaultPrevented && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && props.target !== "_blank" && new URL(event.currentTarget.href).origin === window.location.origin) onNavigate?.({ preventDefault: () => event.preventDefault() });
  event.preventDefault();
}}>{children}</a>; } }));
beforeEach(() => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{ width: 20, height: 20 }]);
});
afterEach(() => { cleanup(); state.pending = false; state.prefetch = null; state.skipNavigate = false; window.history.replaceState({}, "", "/"); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const content = () => <NavigationContent><NavigationContent section="creative"><p>旧页面内容</p></NavigationContent></NavigationContent>;
const navigation = () => <NavigationFeedback><NavigationLink href="/zh/assets">素材库</NavigationLink>{content()}</NavigationFeedback>;

it("preserves the old page until save resolves and invokes link callbacks once", async () => {
  let release; const save = vi.fn(() => new Promise(resolve => { release = resolve; })), onClick = vi.fn(), onNavigate = vi.fn();
  const remove = registerNavigationGuard({ prepare: save }); state.push.mockClear();
  try {
    render(<NavigationFeedback><NavigationLink href="/zh/assets" onClick={onClick} onNavigate={onNavigate}>素材库</NavigationLink>{content()}</NavigationFeedback>);
    fireEvent.click(screen.getByRole("link"));
    expect(screen.getByText("旧页面内容").closest(".navigation-current").hidden).toBe(false); expect(state.push).not.toHaveBeenCalled();
    await act(async () => release());
    expect(state.push).toHaveBeenCalledWith("/zh/assets", { scroll: undefined }); expect(onClick).toHaveBeenCalledOnce(); expect(onNavigate).toHaveBeenCalledOnce();
  } finally { remove(); }
});

it("resumes a guarded local link through visit with no full route request", async () => {
  const visit = vi.fn(() => true), navigate = vi.fn(), remove = registerNavigationGuard({ prepare: async () => {} });
  state.push.mockClear();
  try {
    render(<LocalNavigationContext.Provider value={{ supports: () => true, visit, navigate }}><NavigationLink href="/zh/assets" scroll={false}>素材库</NavigationLink></LocalNavigationContext.Provider>);
    await act(async () => fireEvent.click(screen.getByRole("link")));
    expect(visit).toHaveBeenCalledWith("/zh/assets", { replace: false, scroll: false, locale: undefined }); expect(navigate).not.toHaveBeenCalled(); expect(state.push).not.toHaveBeenCalled();
  } finally { remove(); }
});

it("completes a guarded navigation after its mobile link unmounts", async () => {
  let release; const remove = registerNavigationGuard({ prepare: () => new Promise(resolve => { release = resolve; }) }); state.push.mockClear();
  function Menu() { const [open, setOpen] = useState(true); return open && <NavigationLink href="/zh/assets" onClick={() => setOpen(false)}>Mobile assets</NavigationLink>; }
  try {
    render(<Menu />); fireEvent.click(screen.getByText("Mobile assets")); expect(screen.queryByText("Mobile assets")).toBeNull();
    await act(async () => release()); expect(state.push).toHaveBeenCalledOnce();
  } finally { remove(); }
});

it("does not save for cancelled, modified, download or new-tab link activations", async () => {
  const prepare = vi.fn(), remove = registerNavigationGuard({ prepare });
  try {
    render(<><NavigationLink href="/zh/assets" onNavigate={event => event.preventDefault()}>Cancelled</NavigationLink><NavigationLink href="/zh/assets">Modified</NavigationLink><NavigationLink href="/zh/assets" download="file">Download</NavigationLink><NavigationLink href="/zh/assets" target="_blank">New tab</NavigationLink></>);
    fireEvent.click(screen.getByText("Cancelled")); fireEvent.click(screen.getByText("Modified"), { ctrlKey: true }); fireEvent.click(screen.getByText("Download")); fireEvent.click(screen.getByText("New tab"));
    expect(prepare).not.toHaveBeenCalled();
  } finally { remove(); }
});

it("shows the destination as soon as clicked, before Next starts navigation", () => {
  vi.useFakeTimers();
  state.skipNavigate = true;
  render(navigation());
  fireEvent.click(screen.getByRole("link", { name: "素材库" }));
  expect(state.pending).toBe(false);
  expect(window.location.pathname).toBe("/");
  expect(screen.getByRole("heading", { name: "素材库" })).toBeTruthy();
  expect(screen.getByText("旧页面内容").closest(".navigation-current").hidden).toBe(true);
  expect(document.querySelector(".navigation-progress")).toBeNull();
  act(() => vi.advanceTimersByTime(7900));
  expect(screen.queryByRole("link", { name: "重新打开页面" })).toBeNull();
  act(() => vi.advanceTimersByTime(100));
  expect(screen.getByRole("link", { name: "重新打开页面" }).getAttribute("href")).toBe(new URL("/zh/assets", window.location.href).href);
});

it("clears global feedback when the route changes and prevents a second pending click", () => {
  vi.useFakeTimers();
  const view = render(navigation());
  fireEvent.click(screen.getByRole("link", { name: "素材库" }));
  state.pending = true;
  view.rerender(navigation());
  fireEvent.click(screen.getByRole("link", { name: "素材库" }));
  act(() => window.history.pushState({}, "", "/zh/assets"));
  act(() => vi.advanceTimersByTime(150));
  expect(screen.queryByRole("status")).toBeNull();
  state.pending = false;
  act(() => window.history.replaceState({}, "", "/"));
});

it("keeps feedback visible after the clicked mobile menu unmounts", () => {
  vi.useFakeTimers();
  function Menu() {
    const [open, setOpen] = useState(true);
    return <NavigationFeedback>{open && <NavigationLink href="/zh/assets" onClick={() => setOpen(false)}>素材库</NavigationLink>}{content()}</NavigationFeedback>;
  }
  render(<Menu />);
  fireEvent.click(screen.getByRole("link", { name: "素材库" }));
  expect(screen.queryByRole("link", { name: "素材库" })).toBeNull();
  expect(screen.getByRole("heading", { name: "素材库" })).toBeTruthy();
  act(() => window.history.pushState({}, "", "/zh/assets"));
  act(() => vi.advanceTimersByTime(150));
  expect(screen.queryByRole("status")).toBeNull();
});

it("does not show feedback for a cancelled navigation", () => {
  render(<NavigationFeedback><NavigationLink href="/zh/assets" onNavigate={event => event.preventDefault()}>素材库</NavigationLink>{content()}</NavigationFeedback>);
  fireEvent.click(screen.getByText("素材库"));
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByText("旧页面内容").closest(".navigation-current").hidden).toBe(false);
});

it.each([
  { href: "https://outside.example/", name: "external destination" },
  { href: "/zh/assets", target: "_blank", name: "new tab" },
  { href: "/zh/assets", download: "asset.zip", name: "download" },
])("does not start navigation feedback for a $name", ({ href, ...props }) => {
  render(<NavigationFeedback><NavigationLink href={href} {...props}>目标</NavigationLink>{content()}</NavigationFeedback>);
  fireEvent.click(screen.getByRole("link", { name: "目标" }));
  expect(screen.queryByRole("status")).toBeNull();
});

it("clears feedback when Next finishes the pending transition", () => {
  const view = render(navigation());
  fireEvent.click(screen.getByRole("link", { name: "素材库" }));
  state.pending = true;
  view.rerender(navigation());
  expect(screen.getByRole("link").getAttribute("aria-busy")).toBe("true");
  state.pending = false;
  view.rerender(navigation());
  expect(screen.queryByRole("status")).toBeNull();
});

it("does not send unsolicited route requests even for the legacy idle mode", () => {
  vi.useFakeTimers();
  vi.stubGlobal("requestIdleCallback", undefined);
  vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const preload = vi.fn();
  render(<NavigationLink href="/zh/studio-v2" prefetch="idle" onPrefetch={preload}>画布</NavigationLink>);
  expect(state.prefetch).toBe(false);
  act(() => vi.advanceTimersByTime(4000));
  expect(state.prefetch).toBe(false);
  expect(preload).not.toHaveBeenCalled();
  fireEvent.mouseEnter(screen.getByText("画布"));
  expect(preload).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(150));
  expect(state.prefetch).toBe(true);
  expect(preload).toHaveBeenCalledOnce();
});

it("does not prefetch links passed over while moving the pointer to another module", () => {
  vi.useFakeTimers();
  const preload = vi.fn();
  render(<NavigationLink href="/zh/assets" onPrefetch={preload}>素材库</NavigationLink>);
  const link = screen.getByText("素材库");
  fireEvent.mouseEnter(link);
  act(() => vi.advanceTimersByTime(100));
  fireEvent.mouseLeave(link);
  act(() => vi.advanceTimersByTime(1000));
  expect(state.prefetch).toBe(false);
  expect(preload).not.toHaveBeenCalled();
  fireEvent.mouseEnter(link);
  act(() => vi.advanceTimersByTime(150));
  expect(state.prefetch).toBe(true);
  expect(preload).toHaveBeenCalledOnce();
  fireEvent.mouseLeave(link);
  expect(state.prefetch).toBe(false);
});

it("cancels a touch prefetch timer when the user taps immediately", () => {
  vi.useFakeTimers();
  const preload = vi.fn();
  render(<NavigationLink href="/zh/assets" onPrefetch={preload}>素材库</NavigationLink>);
  const link = screen.getByText("素材库");
  fireEvent.touchStart(link);
  fireEvent.touchEnd(link);
  fireEvent.click(link);
  act(() => vi.advanceTimersByTime(1000));
  expect(state.prefetch).toBe(false);
  expect(preload).not.toHaveBeenCalled();
});

it("does not warm hidden links and cancels timers when unmounted", () => {
  vi.useFakeTimers();
  const preload = vi.fn();
  vi.mocked(HTMLElement.prototype.getClientRects).mockReturnValue([]);
  const view = render(<NavigationLink href="/zh/assets" onPrefetch={preload}>素材库</NavigationLink>);
  fireEvent.mouseEnter(screen.getByText("素材库"));
  act(() => vi.advanceTimersByTime(150));
  expect(state.prefetch).toBe(false);
  expect(preload).not.toHaveBeenCalled();
  fireEvent.mouseEnter(screen.getByText("素材库"));
  view.unmount();
  act(() => vi.advanceTimersByTime(1000));
  expect(preload).not.toHaveBeenCalled();
});

it("does not let an earlier link clear the latest navigation feedback", () => {
  vi.useFakeTimers();
  function Controls() {
    const { begin, finish } = useNavigationFeedback();
    const first = useRef(null);
    return <><button onClick={() => { first.current = begin("/zh/assets"); }}>素材库</button><button onClick={() => begin("/zh/projects")}>项目</button><button onClick={() => finish(first.current)}>结束旧跳转</button></>;
  }
  render(<NavigationFeedback><Controls />{content()}</NavigationFeedback>);
  fireEvent.click(screen.getByText("素材库"));
  fireEvent.click(screen.getByText("项目"));
  fireEvent.click(screen.getByText("结束旧跳转"));
  expect(screen.getByRole("status")).toBeTruthy();
  act(() => vi.advanceTimersByTime(8000));
  expect(screen.getByRole("link", { name: "重新打开页面" }).getAttribute("href")).toBe("/zh/projects");
});

it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }])("leaves the current page alone for a modified click: %o", modifiers => {
  render(navigation());
  fireEvent.click(screen.getByRole("link", { name: "素材库" }), modifiers);
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByText("旧页面内容").closest(".navigation-current").hidden).toBe(false);
});

it("retains old content mounts while showing the destination skeleton", () => {
  const unmount = vi.fn();
  function Draft() {
    useEffect(() => unmount, []);
    return <input aria-label="草稿" defaultValue="未保存的内容" />;
  }
  render(<NavigationFeedback><NavigationLink href="/zh/assets">素材库</NavigationLink><NavigationContent section="creative"><Draft /></NavigationContent></NavigationFeedback>);
  fireEvent.click(screen.getByRole("link", { name: "素材库" }));
  expect(unmount).not.toHaveBeenCalled();
  expect(screen.getByDisplayValue("未保存的内容")).toBeTruthy();
});
