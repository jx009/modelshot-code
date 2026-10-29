// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import DiscoverHome from "../../src/components/discover/DiscoverHome.jsx";
import CreativePages, { CreativePageContent } from "../../src/components/discover/CreativePages.jsx";
import { PageVisibilityContext, useLocalNavigation } from "../../src/components/ui/LocalNavigation.jsx";

const mocks = vi.hoisted(() => ({ read: vi.fn(), clear: vi.fn(), open: vi.fn(), api: vi.fn() }));
vi.mock("@/lib/studio/image-capabilities-client", () => ({ readImageCapabilities: mocks.read, clearImageCapabilities: mocks.clear }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ open: mocks.open }) }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ status: "authenticated", data: { user: { id: "user-a" } } }) }));
vi.mock("next-intl", () => ({ useLocale: () => "zh" }));
vi.mock("next/navigation", () => ({ usePathname: () => window.location.pathname }));
vi.mock("../../src/components/discover/CreativeShell", () => ({ default: ({ children }) => <main>{children}</main> }));
vi.mock("../../src/components/discover/ExplorePage", () => ({ default: () => <h1>灵感页面</h1> }));
vi.mock("@/hooks/useNavigationRouter", () => ({ useNavigationRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/client-api", () => ({ api: mocks.api, requestKey: () => "test-key" }));
vi.mock("@/components/studio/AssetImage", () => ({ default: ({ alt }) => <span>{alt}</span> }));
vi.mock("@/components/ui/NavigationLink", () => ({ default: ({ children, href }) => <a href={href}>{children}</a> }));
vi.mock("@/components/ui/ModelPicker", () => ({ default: ({ models, emptyLabel }) => <span>{models[0]?.label || emptyLabel}</span> }));
vi.mock("@/components/ui/ImageSizePicker", () => ({ default: () => null }));
vi.mock("next/dynamic", () => ({ default: () => () => <div data-testid="gallery-shell" /> }));
beforeEach(() => {
  mocks.read.mockReset(); mocks.clear.mockReset(); sessionStorage.clear();
  mocks.api.mockReset().mockResolvedValue({ poster: true, slides: true, document: true, sheet: true, web: true, languageUnitCost: 2 });
  window.history.replaceState(null, "", "/zh");
});
afterEach(cleanup);

function PageLinks() {
  const navigation = useLocalNavigation();
  return <nav><button onClick={() => navigation.visit("/explore", { scroll: false })}>查看灵感</button><button onClick={() => navigation.visit("/", { scroll: false })}>回到首页</button></nav>;
}

test("keeps the actual composer visible through local navigation while models are pending", async () => {
  mocks.read.mockImplementation(() => new Promise(() => {}));
  render(<CreativePages><PageLinks /><CreativePageContent><h1>旧的服务端路由内容</h1></CreativePageContent></CreativePages>);
  const composer = screen.getByRole("textbox", { name: "描述你的创意" });
  fireEvent.change(composer, { target: { value: "切回来仍然可以继续写" } });
  expect(screen.getByRole("button", { name: "开始创作" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "旧的服务端路由内容" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "查看灵感" }));
  await screen.findByRole("heading", { name: "灵感页面" });
  expect(screen.queryByRole("textbox", { name: "描述你的创意" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "回到首页" }));
  expect(screen.getByRole("textbox", { name: "描述你的创意" })).toBe(composer);
  expect(composer.value).toBe("切回来仍然可以继续写");
  expect(screen.getByRole("button", { name: "开始创作" })).toBeTruthy();
});

test("renders the editable composer and gallery shell without waiting for models or an idle timer", async () => {
  let resolve;
  mocks.read.mockImplementation(() => new Promise(done => { resolve = done; }));
  render(<DiscoverHome />);
  fireEvent.change(screen.getByLabelText("描述你的创意"), { target: { value: "先写提示词" } });
  expect(screen.getByLabelText("描述你的创意").value).toBe("先写提示词");
  expect(screen.getByText("正在加载模型…")).toBeTruthy();
  expect(screen.getByTestId("gallery-shell")).toBeTruthy();
  const data = { imageProvider: "model-a", imageModels: [{ id: "model-a", label: "模型 A", creditCost: 18 }], tools: [] };
  mocks.read.mockResolvedValue(data);
  await act(async () => resolve(data));
  expect(screen.getByText("模型 A")).toBeTruthy();
  expect(screen.getByLabelText("描述你的创意").value).toBe("先写提示词");
});

test("reports model load failures separately and retries without replacing the composer", async () => {
  mocks.read.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ imageProvider: null, imageModels: [], tools: [] });
  render(<DiscoverHome />);
  await screen.findByRole("button", { name: "重试加载模型" });
  fireEvent.change(screen.getByLabelText("描述你的创意"), { target: { value: "保留输入" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "重试加载模型" })));
  expect(mocks.clear).toHaveBeenCalledOnce();
  expect(mocks.read).toHaveBeenCalledTimes(2);
  expect(screen.getByLabelText("描述你的创意").value).toBe("保留输入");
});

test("shows only individually enabled creation buttons", async () => {
  mocks.read.mockImplementation(() => new Promise(() => {}));
  mocks.api.mockResolvedValue({ launcherVisibility: { image: true, motion: false, video: false, poster: true, slides: true, document: false, sheet: false, web: false } });
  render(<DiscoverHome />);
  expect(await screen.findByRole("button", { name: "演示文稿" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "图片创作" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "海报设计" })).toBeTruthy();
  for (const name of ["视频制作", "视频生成", "文档", "表格", "网页"]) expect(screen.queryByRole("button", { name })).toBeNull();
  expect(document.querySelector(".cr-creation-types").className).toContain("cr-creation-types");
});

test("does not start a model read for a retained hidden homepage", () => {
  render(<PageVisibilityContext.Provider value={false}><DiscoverHome /></PageVisibilityContext.Provider>);
  expect(mocks.read).not.toHaveBeenCalled();
});

test.each(["海报设计", "演示文稿", "文档", "表格", "网页"])("opens the %s form synchronously and preserves its draft while optional chunks are unavailable", async type => {
  mocks.read.mockImplementation(() => new Promise(() => {}));
  render(<DiscoverHome />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: type }));
  // next/dynamic is stubbed above: no optional chunk can resolve in this test.
  const composer = screen.getByRole("textbox", { name: "创作需求" });
  expect(composer.disabled).toBe(false);
  expect(screen.getByRole("button", { name: "添加素材" })).toBeTruthy();
  fireEvent.change(composer, { target: { value: "切换后继续编辑" } });
  fireEvent.click(screen.getByRole("button", { name: "图片创作" }));
  expect(screen.getByRole("textbox", { name: "描述你的创意" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: type }));
  expect(screen.getByRole("textbox", { name: "创作需求" }).value).toBe("切换后继续编辑");
  expect(mocks.api.mock.calls.map(([url]) => url)).toEqual(["/api/creation/capabilities"]);
});
