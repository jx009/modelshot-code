// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import DiscoverHome from "../../src/components/discover/DiscoverHome.jsx";
import { PageVisibilityContext } from "../../src/components/ui/LocalNavigation.jsx";

const mocks = vi.hoisted(() => ({ read: vi.fn(), clear: vi.fn(), open: vi.fn() }));
vi.mock("@/lib/studio/image-capabilities-client", () => ({ readImageCapabilities: mocks.read, clearImageCapabilities: mocks.clear }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ open: mocks.open }) }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ status: "authenticated", data: { user: { id: "user-a" } } }) }));
vi.mock("next-intl", () => ({ useLocale: () => "zh" }));
vi.mock("@/hooks/useNavigationRouter", () => ({ useNavigationRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/client-api", () => ({ api: vi.fn(), requestKey: () => "test-key" }));
vi.mock("@/components/studio/AssetImage", () => ({ default: ({ alt }) => <span>{alt}</span> }));
vi.mock("@/components/ui/NavigationLink", () => ({ default: ({ children, href }) => <a href={href}>{children}</a> }));
vi.mock("@/components/ui/ModelPicker", () => ({ default: ({ models, emptyLabel }) => <span>{models[0]?.label || emptyLabel}</span> }));
vi.mock("@/components/ui/ImageSizePicker", () => ({ default: () => null }));
vi.mock("next/dynamic", () => ({ default: () => () => <div data-testid="gallery-shell" /> }));
beforeEach(() => { mocks.read.mockReset(); mocks.clear.mockReset(); });
afterEach(cleanup);

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

test("does not start a model read for a retained hidden homepage", () => {
  render(<PageVisibilityContext.Provider value={false}><DiscoverHome /></PageVisibilityContext.Provider>);
  expect(mocks.read).not.toHaveBeenCalled();
});
