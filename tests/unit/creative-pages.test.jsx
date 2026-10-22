// @vitest-environment jsdom
import { useState, useSyncExternalStore } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import CreativePages, { CreativePageContent } from "../../src/components/discover/CreativePages.jsx";
import NavigationLink from "../../src/components/ui/NavigationLink.jsx";
import { usePageVisible } from "../../src/components/ui/LocalNavigation.jsx";

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), user: "user-a" }));
vi.mock("next-intl", () => ({ useLocale: () => "zh" }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: mocks.user ? { user: { id: mocks.user } } : null }) }));
vi.mock("next/link", () => ({ useLinkStatus: () => ({ pending: false }) }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => null }));
vi.mock("../../src/components/discover/CreativeShell", () => ({ default: ({ children }) => <main>{children}</main> }));
vi.mock("../../src/components/discover/CreativeProjects", () => ({ default: () => <h1>项目内容</h1> }));
vi.mock("@/components/studio/AssetLibrary", () => ({ default: function Assets() {
  const [query, setQuery] = useState("");
  return <section><h1>素材内容</h1><input aria-label="素材搜索" value={query} onChange={event => setQuery(event.target.value)} /></section>;
} }));
vi.mock("../../src/components/discover/CommercePage", () => ({ default: () => <h1>电商内容</h1> }));
vi.mock("@/components/studio/StudioPage", () => ({ default: () => <h1>画布内容</h1> }));
vi.mock("@/components/billing/PricingPage", () => ({ default: () => <h1>充值内容</h1> }));
vi.mock("next/navigation", () => ({ usePathname: () => useSyncExternalStore(subscribe, () => window.location.pathname) }));
vi.mock("@/i18n/navigation", () => ({ Link: ({ href, locale = "zh", prefetch, children, onClick, onNavigate, ...props }) => <a {...props} href={`/${locale}${href}`} data-prefetch={String(prefetch)} onClick={event => {
  onClick?.(event);
  if (!event.defaultPrevented && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && !event.currentTarget.target && !event.currentTarget.hasAttribute("download")) {
    onNavigate?.({ preventDefault: () => event.preventDefault() });
    if (!event.defaultPrevented) mocks.navigate(href);
  }
  event.preventDefault();
}}>{children}</a> }));
vi.mock("../../src/components/discover/DiscoverHome", () => ({ default: function Home() {
  const [text, setText] = useState("");
  const visible = usePageVisible();
  return <section><h1>创作内容</h1><input aria-label="草稿" value={text} onChange={event => setText(event.target.value)} /><span data-testid="home-visible">{String(visible)}</span></section>;
} }));
vi.mock("../../src/components/discover/ExplorePage", () => ({ default: function Explore() {
  const [query, setQuery] = useState("");
  return <section><h1>灵感内容</h1><input aria-label="筛选" value={query} onChange={event => setQuery(event.target.value)} /></section>;
} }));

function subscribe(callback) {
  window.addEventListener("creative-test-history", callback);
  window.addEventListener("popstate", callback);
  return () => { window.removeEventListener("creative-test-history", callback); window.removeEventListener("popstate", callback); };
}
function Shell() {
  return <CreativePages><nav>
    <NavigationLink href="/">首页</NavigationLink>
    <NavigationLink href="/explore">灵感</NavigationLink>
    <NavigationLink href="/explore?category=poster">海报</NavigationLink>
    <NavigationLink href="/projects">项目</NavigationLink>
    <NavigationLink href="/assets">素材</NavigationLink>
    <NavigationLink href="/commerce?document=commerce-one">电商</NavigationLink>
    <NavigationLink href="/studio-v2?document=canvas-one">画布</NavigationLink>
    <NavigationLink href="/pricing">充值</NavigationLink>
    <NavigationLink href="/admin">管理台</NavigationLink>
    <NavigationLink href="/assets" onNavigate={event => event.preventDefault()}>取消导航</NavigationLink>
    <NavigationLink href="/" locale="en">English</NavigationLink>
    <NavigationLink href="/explore" target="_blank">新窗口</NavigationLink>
    <NavigationLink href="/explore" download>下载</NavigationLink>
  </nav><CreativePageContent><h1>其他页面</h1></CreativePageContent></CreativePages>;
}
beforeEach(() => {
  mocks.user = "user-a"; mocks.navigate.mockReset();
  window.history.replaceState(null, "", "/zh");
  const push = window.history.pushState.bind(window.history);
  vi.spyOn(window.history, "pushState").mockImplementation((...args) => { push(...args); window.dispatchEvent(new Event("creative-test-history")); });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test("switches visited pages locally while preserving drafts and filters", async () => {
  render(<Shell />);
  await screen.findByRole("heading", { name: "创作内容" });
  fireEvent.change(screen.getByLabelText("草稿"), { target: { value: "不要丢失" } });
  expect(screen.getByRole("link", { name: "灵感" }).dataset.prefetch).toBe("false");
  fireEvent.click(screen.getByRole("link", { name: "灵感" }));
  await screen.findByRole("heading", { name: "灵感内容" });
  expect(screen.queryByRole("heading", { name: "创作内容" })).toBeNull();
  expect(screen.getByTestId("home-visible").textContent).toBe("false");
  fireEvent.change(screen.getByLabelText("筛选"), { target: { value: "猫" } });
  fireEvent.click(screen.getByRole("link", { name: "首页" }));
  expect(screen.getByRole("heading", { name: "创作内容" })).toBeTruthy();
  expect(screen.getByLabelText("草稿").value).toBe("不要丢失");
  fireEvent.click(screen.getByRole("link", { name: "灵感" }));
  expect(screen.getByLabelText("筛选").value).toBe("猫");
  expect(mocks.navigate).not.toHaveBeenCalled();
});

test("handles query links and browser history without page fetches", async () => {
  render(<Shell />);
  await screen.findByRole("heading", { name: "创作内容" });
  fireEvent.click(screen.getByRole("link", { name: "海报" }));
  await screen.findByRole("heading", { name: "灵感内容" });
  expect(window.location.search).toBe("?category=poster");
  act(() => { window.history.replaceState(null, "", "/zh"); window.dispatchEvent(new PopStateEvent("popstate")); });
  expect(screen.getByRole("heading", { name: "创作内容" })).toBeTruthy();
  expect(mocks.navigate).not.toHaveBeenCalled();
});

test("renders a directly opened explore page and restores other routes", async () => {
  window.history.replaceState(null, "", "/zh/explore");
  render(<Shell />);
  await screen.findByRole("heading", { name: "灵感内容" });
  expect(screen.queryByRole("heading", { name: "创作内容" })).toBeNull();
  act(() => { window.history.replaceState(null, "", "/zh/explore/example"); window.dispatchEvent(new PopStateEvent("popstate")); });
  expect(screen.getByRole("heading", { name: "其他页面" })).toBeTruthy();
  fireEvent.click(screen.getByRole("link", { name: "首页" }));
  await screen.findByRole("heading", { name: "创作内容" });
  expect(mocks.navigate).not.toHaveBeenCalled();
});

test("clears retained private inputs when the account changes", async () => {
  const view = render(<Shell />);
  await screen.findByRole("heading", { name: "创作内容" });
  fireEvent.change(screen.getByLabelText("草稿"), { target: { value: "私有草稿" } });
  mocks.user = "user-b"; view.rerender(<Shell />);
  expect(screen.getByLabelText("草稿").value).toBe("");
  mocks.user = null; view.rerender(<Shell />);
  expect(screen.getByLabelText("草稿").value).toBe("");
});

test("preserves modified clicks and leaves other routes and locales to Next", async () => {
  render(<Shell />);
  await screen.findByRole("heading", { name: "创作内容" });
  fireEvent.click(screen.getByRole("link", { name: "灵感" }), { ctrlKey: true });
  fireEvent.click(screen.getByRole("link", { name: "新窗口" }));
  fireEvent.click(screen.getByRole("link", { name: "下载" }));
  expect(window.history.pushState).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("link", { name: "管理台" }));
  expect(mocks.navigate).toHaveBeenCalledWith("/admin");
  fireEvent.click(screen.getByRole("link", { name: "English" }));
  expect(mocks.navigate).toHaveBeenCalledWith("/");
  expect(window.history.pushState).not.toHaveBeenCalled();
});

test("all primary modules switch locally and retained pages survive canvas and pricing visits", async () => {
  render(<Shell />);
  await screen.findByRole("heading", { name: "创作内容" });
  fireEvent.change(screen.getByLabelText("草稿"), { target: { value: "跨模块保留" } });
  for (const [label, heading] of [["项目", "项目内容"], ["素材", "素材内容"], ["电商", "电商内容"], ["画布", "画布内容"], ["充值", "充值内容"]]) {
    fireEvent.click(screen.getByRole("link", { name: label, exact: true }));
    await screen.findByRole("heading", { name: heading });
    expect(screen.queryByRole("heading", { name: "创作内容" })).toBeNull();
  }
  fireEvent.click(screen.getByRole("link", { name: "首页" }));
  expect(screen.getByLabelText("草稿").value).toBe("跨模块保留");
  expect(mocks.navigate).not.toHaveBeenCalled();
});

test.each([["/projects", "项目内容"], ["/assets", "素材内容"], ["/commerce?document=one", "电商内容"], ["/studio-v2?new=1", "画布内容"], ["/pricing", "充值内容"]])("direct entry %s renders the correct module", async (path, heading) => {
  window.history.replaceState(null, "", `/zh${path}`);
  render(<Shell />);
  await screen.findByRole("heading", { name: heading });
  expect(mocks.navigate).not.toHaveBeenCalled();
});

test("local navigation honors onNavigate cancellation", async () => {
  render(<Shell />);
  await screen.findByRole("heading", { name: "创作内容" });
  fireEvent.click(screen.getByRole("link", { name: "取消导航" }));
  expect(window.history.pushState).not.toHaveBeenCalled();
  expect(mocks.navigate).not.toHaveBeenCalled();
});
