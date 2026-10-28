// @vitest-environment jsdom
import { useInsertionEffect, useState, useSyncExternalStore } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import CreativePages, { CreativePageContent } from "../../src/components/discover/CreativePages.jsx";
import NavigationLink from "../../src/components/ui/NavigationLink.jsx";
import { usePageVisible, useLocalNavigation } from "../../src/components/ui/LocalNavigation.jsx";
import { registerNavigationGuard } from "../../src/lib/navigation-guard.js";
import { writeGalleryCache } from "../../src/lib/inspiration/client-cache.js";

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), user: "user-a", pathname: null }));
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
vi.mock("@/components/video/VideoWorkspace", () => ({ default: () => <h1>视频内容</h1> }));
vi.mock("next/navigation", () => ({ usePathname: () => {
  const pathname = useSyncExternalStore(subscribe, () => window.location.pathname);
  return mocks.pathname ?? pathname;
} }));
vi.mock("../../src/components/discover/InspirationDetail", () => ({ default: ({ item }) => <h1>详情：{item.title}</h1> }));
vi.mock("../../src/components/discover/InspirationDetailImage", () => ({ default: ({ item }) => <span>{item.title}预览</span> }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: mocks.navigate, replace: mocks.navigate }), Link: ({ href, locale = "zh", prefetch, children, onClick, onNavigate, ...props }) => <a {...props} href={`/${locale}${href}`} data-prefetch={String(prefetch)} onClick={event => {
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
  return <section><h1>灵感内容</h1><input aria-label="筛选" value={query} onChange={event => setQuery(event.target.value)} /><NavigationLink href="/explore/public-one">打开灵感图片</NavigationLink><NavigationLink href="/explore/legacy">打开旧案例</NavigationLink></section>;
} }));

function subscribe(callback) {
  window.addEventListener("creative-test-history", callback);
  window.addEventListener("popstate", callback);
  return () => { window.removeEventListener("creative-test-history", callback); window.removeEventListener("popstate", callback); };
}
function Shell({ children = <h1>其他页面</h1> }) {
  return <CreativePages><nav>
    <NavigationLink href="/">首页</NavigationLink>
    <NavigationLink href="/explore">灵感</NavigationLink>
    <NavigationLink href="/explore?category=poster">海报</NavigationLink>
    <NavigationLink href="/projects">项目</NavigationLink>
    <NavigationLink href="/assets">素材</NavigationLink>
    <NavigationLink href="/commerce?document=commerce-one">电商</NavigationLink>
    <NavigationLink href="/studio-v2?document=canvas-one">画布</NavigationLink>
    <NavigationLink href="/video">视频</NavigationLink>
    <NavigationLink href="/admin">管理台</NavigationLink>
    <NavigationLink href="/assets" onNavigate={event => event.preventDefault()}>取消导航</NavigationLink>
    <NavigationLink href="/" locale="en">English</NavigationLink>
    <NavigationLink href="/explore" target="_blank">新窗口</NavigationLink>
    <NavigationLink href="/explore" download>下载</NavigationLink>
  </nav><CreativePageContent>{children}</CreativePageContent></CreativePages>;
}
beforeEach(() => {
  mocks.user = "user-a"; mocks.navigate.mockReset();
  mocks.pathname = null;
  writeGalleryCache({ items: [], layout: { mode: "masonry", columns: 4, gap: 16 } });
  window.history.replaceState(null, "", "/zh");
  const push = window.history.pushState.bind(window.history);
  vi.spyOn(window.history, "pushState").mockImplementation((...args) => { push(...args); window.dispatchEvent(new Event("creative-test-history")); });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test("defers a direct local visit until saving completes, without changing the history early", async () => {
  let release; const prepare = vi.fn(() => new Promise(resolve => { release = resolve; })), remove = registerNavigationGuard({ prepare });
  function Direct() { const navigation = useLocalNavigation(); return <button onClick={() => navigation.visit("/assets")}>Direct visit</button>; }
  try {
    render(<CreativePages><Direct /><CreativePageContent /></CreativePages>);
    fireEvent.click(screen.getByText("Direct visit"));
    expect(window.location.pathname).toBe("/zh"); expect(prepare).toHaveBeenCalledOnce(); expect(window.history.pushState).not.toHaveBeenCalled();
    await act(async () => release());
    await screen.findByRole("heading", { name: "素材内容" });
    expect(window.history.pushState).toHaveBeenCalledTimes(1); expect(mocks.navigate).not.toHaveBeenCalled();
  } finally { remove(); }
});

test("opens a cached inspiration on the first click and preserves filters on return", async () => {
  const item = { id: "public-one", title: "已加载的灵感", enabled: true };
  writeGalleryCache({ items: [item], layout: { mode: "masonry", columns: 4, gap: 16 } });
  render(<Shell />);
  fireEvent.click(screen.getByRole("link", { name: "灵感", exact: true }));
  await screen.findByRole("heading", { name: "灵感内容" });
  fireEvent.change(screen.getByLabelText("筛选"), { target: { value: "保留筛选" } });
  fireEvent.click(screen.getByRole("link", { name: "打开灵感图片" }));
  await screen.findByRole("heading", { name: "详情：已加载的灵感" });
  expect(window.location.pathname).toBe("/zh/explore/public-one");
  expect(screen.queryByRole("heading", { name: "灵感内容" })).toBeNull();
  expect(mocks.navigate).not.toHaveBeenCalled();
  act(() => { window.history.replaceState(null, "", "/zh/explore"); window.dispatchEvent(new PopStateEvent("popstate")); });
  expect(screen.getByLabelText("筛选").value).toBe("保留筛选");
  act(() => { window.history.replaceState(null, "", "/zh/explore/public-one"); window.dispatchEvent(new PopStateEvent("popstate")); });
  expect(screen.getByRole("heading", { name: "详情：已加载的灵感" })).toBeTruthy();
});

function NextHistoryCommit({ pathname, children }) {
  useInsertionEffect(() => { window.history.replaceState(null, "", pathname); }, [pathname]);
  return children;
}

test("observes a Next route commit that updates history after render without popstate", async () => {
  mocks.pathname = "/zh/explore";
  window.history.replaceState(null, "", mocks.pathname);
  const view = render(<NextHistoryCommit pathname={mocks.pathname}><Shell /></NextHistoryCommit>);
  await screen.findByRole("heading", { name: "灵感内容" });
  fireEvent.click(screen.getByRole("link", { name: "打开旧案例" }));
  expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith("/explore/legacy");
  mocks.pathname = "/zh/explore/legacy";
  view.rerender(<NextHistoryCommit pathname={mocks.pathname}><Shell><h1>服务端旧案例详情</h1></Shell></NextHistoryCommit>);
  expect(await screen.findByRole("heading", { name: "服务端旧案例详情" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "灵感内容" })).toBeNull();
});

test("direct detail visits keep server validation instead of trusting stored gallery entries", () => {
  writeGalleryCache({ items: [{ id: "public-one", title: "已过期的灵感" }], layout: { mode: "masonry", columns: 4, gap: 16 } });
  window.history.replaceState(null, "", "/zh/explore/public-one");
  render(<Shell><h1>服务端核验过的详情</h1></Shell>);
  expect(screen.getByRole("heading", { name: "服务端核验过的详情" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "详情：已过期的灵感" })).toBeNull();
});

test("disabled inspiration entries still use the validated server route", async () => {
  writeGalleryCache({ items: [{ id: "public-one", title: "已下架", enabled: false }], layout: { mode: "masonry", columns: 4, gap: 16 } });
  window.history.replaceState(null, "", "/zh/explore");
  render(<Shell />);
  await screen.findByRole("heading", { name: "灵感内容" });
  fireEvent.click(screen.getByRole("link", { name: "打开灵感图片" }));
  expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith("/explore/public-one");
});

test("renders the homepage immediately instead of a stale layout route slot", () => {
  render(<Shell><h1>旧的灵感路由插槽</h1></Shell>);
  expect(screen.getByRole("heading", { name: "创作内容" })).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "草稿" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "旧的灵感路由插槽" })).toBeNull();
});

test("keeps the homepage draft when the server route slot changes", async () => {
  const view = render(<Shell><h1>首页路由插槽</h1></Shell>);
  fireEvent.change(screen.getByRole("textbox", { name: "草稿" }), { target: { value: "不要替换我的输入框" } });
  fireEvent.click(screen.getByRole("link", { name: "灵感" }));
  await screen.findByRole("heading", { name: "灵感内容" });
  view.rerender(<Shell><h1>灵感路由插槽</h1></Shell>);
  fireEvent.click(screen.getByRole("link", { name: "首页" }));
  expect(screen.getByRole("textbox", { name: "草稿" }).value).toBe("不要替换我的输入框");
  expect(screen.queryByRole("heading", { name: "灵感路由插槽" })).toBeNull();
});

test("does not replace the homepage with the entry route after session resolution", async () => {
  mocks.user = null;
  window.history.replaceState(null, "", "/zh/explore");
  const view = render(<Shell><h1>首次打开的灵感路由插槽</h1></Shell>);
  await screen.findByRole("heading", { name: "灵感内容" });
  fireEvent.click(screen.getByRole("link", { name: "首页" }));
  expect(screen.getByRole("textbox", { name: "草稿" })).toBeTruthy();
  mocks.user = "user-a";
  view.rerender(<Shell><h1>首次打开的灵感路由插槽</h1></Shell>);
  expect(screen.getByRole("textbox", { name: "草稿" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "首次打开的灵感路由插槽" })).toBeNull();
});

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
  for (const [label, heading] of [["项目", "项目内容"], ["素材", "素材内容"], ["电商", "电商内容"], ["画布", "画布内容"], ["视频", "视频内容"]]) {
    fireEvent.click(screen.getByRole("link", { name: label, exact: true }));
    await screen.findByRole("heading", { name: heading });
    expect(screen.queryByRole("heading", { name: "创作内容" })).toBeNull();
  }
  fireEvent.click(screen.getByRole("link", { name: "首页" }));
  expect(screen.getByLabelText("草稿").value).toBe("跨模块保留");
  expect(mocks.navigate).not.toHaveBeenCalled();
});

test.each([["/projects", "项目内容"], ["/assets", "素材内容"], ["/commerce?document=one", "电商内容"], ["/studio-v2?new=1", "画布内容"], ["/video?document=one", "视频内容"]])("direct entry %s renders the correct module", async (path, heading) => {
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
