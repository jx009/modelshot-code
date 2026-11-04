// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import DiscoverHome from "../../src/components/discover/DiscoverHome.jsx";

const mocks = vi.hoisted(() => ({ upload: vi.fn(), open: vi.fn(), status: "authenticated", sequence: 0 }));
vi.mock("@/lib/upload-image", () => ({ uploadImage: mocks.upload }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ open: mocks.open }) }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ status: mocks.status }) }));
vi.mock("next-intl", () => ({ useLocale: () => "zh" }));
vi.mock("@/hooks/useNavigationRouter", () => ({ useNavigationRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/client-api", () => ({ api: async () => ({ imageModels: [] }), requestKey: () => `layer-${++mocks.sequence}` }));
vi.mock("@/components/studio/AssetImage", () => ({ default: ({ alt }) => <span>{alt}</span> }));
vi.mock("@/components/ui/NavigationLink", () => ({ default: ({ children, href }) => <a href={href}>{children}</a> }));
vi.mock("@/components/ui/ModelPicker", () => ({ default: () => null }));
vi.mock("@/components/ui/ImageSizePicker", () => ({ default: () => null }));
vi.mock("@/components/discover/InspirationGallery", () => ({ default: () => null }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));

const image = () => new File(["image"], "screenshot.png", { type: "image/png" });
const paste = (target, files) => fireEvent.paste(target, { clipboardData: { files } });
beforeEach(() => {
  mocks.status = "authenticated";
  mocks.upload.mockReset().mockResolvedValue({ assetId: "uploaded-image", width: 640, height: 480 });
  mocks.open.mockClear();
});
afterEach(cleanup);

it.each(["prompt", "page"])("pastes an image from the %s into homepage reference images", async target => {
  render(<DiscoverHome />);
  const file = image();
  expect(paste(target === "prompt" ? screen.getByLabelText("描述你的创意") : document.body, [file])).toBe(false);
  await waitFor(() => expect(screen.getByLabelText("移除参考图1")).toBeTruthy());
  expect(mocks.upload).toHaveBeenCalledExactlyOnceWith(file);
});

it("preserves text paste and does not upload from unrelated editors or dialogs", () => {
  render(<><DiscoverHome /><input aria-label="search" /></>);
  expect(paste(screen.getByLabelText("描述你的创意"), [])).toBe(true);
  expect(paste(screen.getByLabelText("search"), [image()])).toBe(true);
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog"); document.body.append(dialog);
  expect(paste(document.body, [image()])).toBe(true);
  dialog.remove();
  expect(mocks.upload).not.toHaveBeenCalled();
});

it("does not upload from another homepage mode or a hidden outgoing page", () => {
  const view = render(<DiscoverHome />);
  fireEvent.click(screen.getByRole("tab", { name: /电商套图/ }));
  paste(document.body, [image()]);
  view.rerender(<div hidden inert><DiscoverHome /></div>);
  paste(document.body, [image()]);
  expect(mocks.upload).not.toHaveBeenCalled();
});

it("requests login before uploading a clipboard image", () => {
  mocks.status = "unauthenticated";
  render(<DiscoverHome />);
  paste(screen.getByLabelText("描述你的创意"), [image()]);
  expect(mocks.open).toHaveBeenCalledOnce();
  expect(mocks.upload).not.toHaveBeenCalled();
});

it("reports upload failures and a full reference list instead of silently ignoring paste", async () => {
  mocks.upload.mockRejectedValueOnce(new Error("图片不能超过 50 MB"));
  render(<DiscoverHome />);
  paste(document.body, [image()]);
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("50 MB"));
  paste(document.body, [image(), image(), image()]);
  await waitFor(() => expect(screen.getByLabelText("移除参考图3")).toBeTruthy());
  paste(document.body, [image()]);
  expect(screen.getByRole("alert").textContent).toContain("最多添加 3 张");
  expect(mocks.upload).toHaveBeenCalledTimes(4);
});

it("does not upload twice when another image is pasted during an upload", async () => {
  let finish;
  mocks.upload.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<DiscoverHome />);
  paste(document.body, [image()]);
  paste(document.body, [image()]);
  expect(mocks.upload).toHaveBeenCalledOnce();
  expect(screen.getByRole("alert").textContent).toContain("正在处理");
  finish({ assetId: "uploaded-image", width: 640, height: 480 });
  await waitFor(() => expect(screen.getByLabelText("移除参考图1")).toBeTruthy());
});

it("shows the first uploaded image while a second image is still uploading", async () => {
  let finishSlow;
  mocks.upload.mockResolvedValueOnce({ assetId: "first-image", width: 640, height: 480 })
    .mockImplementationOnce(() => new Promise(resolve => { finishSlow = resolve; }));
  render(<DiscoverHome />);
  paste(document.body, [image(), new File(["image"], "slow.png", { type: "image/png" })]);
  expect(screen.getByRole("region", { name: "图片上传状态" })).toBeTruthy();
  await waitFor(() => expect(screen.getByLabelText("移除参考图1")).toBeTruthy());
  expect(screen.queryByLabelText("移除参考图2")).toBeNull();
  expect(screen.getByRole("region", { name: "图片上传状态" }).textContent).toContain("slow.png");
  await act(async () => finishSlow({ assetId: "second-image", width: 640, height: 480 }));
  expect(screen.getByLabelText("移除参考图2")).toBeTruthy();
  expect(screen.queryByRole("region", { name: "图片上传状态" })).toBeNull();
});
