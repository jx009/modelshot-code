// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import VideoWorkspace from "../../src/components/video/VideoWorkspace";
import { WorkspaceHeaderProvider, WorkspaceHeaderSlot } from "../../src/components/creation/WorkspaceHeader";
import { emptyComposition } from "../../src/lib/video/timeline";

const mocks = vi.hoisted(() => ({ mode: "motion", project: null, api: vi.fn(), mobile: false, theme: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(`document=project_1&mode=${mocks.mode}`) }));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ status: "authenticated", data: { user: { id: "user_1" } } }) }));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "dark", setTheme: mocks.theme }) }));
vi.mock("../../src/components/auth/AuthProvider", () => ({ useAuth: () => ({ open: vi.fn() }) }));
vi.mock("../../src/components/ui/NavigationLink", () => ({ default: ({ children, ...props }) => <a {...props}>{children}</a> }));
vi.mock("../../src/lib/client-api", () => ({ api: (...args) => mocks.api(...args), requestKey: () => "test-request-key", terminalStatus: status => ["succeeded", "failed", "cancelled"].includes(status) }));
vi.mock("../../src/components/video/useVideoProject", () => ({ default: () => mocks.project }));
vi.mock("../../src/hooks/useNavigationRouter", () => ({ useNavigationRouter: () => ({ push: vi.fn() }) }));
vi.mock("../../src/components/video/StoryboardWorkspace", () => ({ default: ({ view }) => <div aria-label={view === "table" ? "Storyboard table" : "Storyboard preview"} /> }));
vi.mock("../../src/components/video/useStoryboardRun", () => ({ default: () => ({ run: null, active: false, states: {}, busy: false, error: "" }) }));
vi.mock("../../src/components/video/MotionPreview", () => ({ default: () => <div aria-label="Motion preview" /> }));

function Shell({ workspace = true }) {
  return <WorkspaceHeaderProvider><header aria-label="Workspace toolbar"><WorkspaceHeaderSlot name="title" /><WorkspaceHeaderSlot name="actions" /></header>{workspace && <VideoWorkspace />}</WorkspaceHeaderProvider>;
}

beforeEach(() => {
  mocks.mode = "motion"; mocks.mobile = false;
  mocks.api.mockReset().mockResolvedValue({ video: true, motion: true, tools: [{ id: "motion-plan", available: true, cost: 2 }, { id: "motion-render", available: true, cost: 0 }, { id: "video", available: true, cost: 10 }] });
  mocks.project = {
    id: "project_1", draft: { name: "My film", content: { messages: [], layers: [], video: { mode: "motion", ratio: "16:9", duration: 5, confirmed: true, composition: emptyComposition("scene_1"), media: [] } } },
    change: vi.fn(), save: vi.fn().mockResolvedValue({ id: "project_1" }), submit: vi.fn().mockResolvedValue({ documentId: "project_1" }), upload: vi.fn(), setError: vi.fn(),
    jobs: [], loading: false, loadFailed: false, jobsLoading: false, working: false, active: false, applying: false, error: "", saving: false, dirty: false, recovery: null,
  };
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: mocks.mobile }));
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ width: 1200, height: 700, left: 0, top: 0, right: 1200, bottom: 700 });
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("renders only the shared toolbar with no nested project or pane header", async () => {
  render(<Shell />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Export MP4" }).disabled).toBe(false));
  expect(document.querySelectorAll("header")).toHaveLength(1);
  const toolbar = screen.getByRole("banner", { name: "Workspace toolbar" });
  expect(within(toolbar).getByLabelText("Project name").value).toBe("My film");
  expect(document.querySelector(".vm-project-header,.vm-pane-title,.vm-output-toolbar,.vm-mobile-tabs")).toBeNull();
  expect(screen.getByRole("separator", { name: "Resize conversation panel" })).not.toBeNull();
  expect(document.querySelector(".vm-files")).toBeNull();
});

it("keeps rename, editing, file visibility and export available in one toolbar", async () => {
  render(<Shell />);
  fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "Renamed film" } });
  expect(mocks.project.change.mock.calls[0][0](mocks.project.draft).name).toBe("Renamed film");
  // 分镜工程默认打开分镜表；顶栏按钮在分镜表与预览之间切换。
  expect(screen.getByLabelText("Storyboard table")).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Finish editing" }));
  expect(screen.getByLabelText("Storyboard preview")).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Edit video" }));
  expect(screen.getByLabelText("Storyboard table")).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Toggle files" }));
  expect(document.querySelector(".vm-files")).not.toBeNull();
  const exportButton = screen.getByRole("button", { name: "Export MP4" });
  await waitFor(() => expect(exportButton.disabled).toBe(false));
  fireEvent.click(exportButton);
  await waitFor(() => expect(mocks.project.submit).toHaveBeenCalledWith("motion-render", "", expect.objectContaining({ available: true, cost: 0 })));
  fireEvent.click(screen.getByLabelText("More workspace actions"));
  fireEvent.click(screen.getByRole("button", { name: "Save project" }));
  expect(mocks.project.save).toHaveBeenCalled();
});

it("switches mobile views without adding another navigation row", () => {
  mocks.mobile = true;
  render(<Shell />);
  fireEvent.click(screen.getByRole("button", { name: "Toggle conversation and preview" }));
  expect(document.querySelector(".vm-workspace").classList.contains("tab-preview")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Toggle conversation and preview" }));
  expect(document.querySelector(".vm-workspace").classList.contains("tab-chat")).toBe(true);
  expect(document.querySelectorAll("header")).toHaveLength(1);
});

it("keeps generated-video download without showing motion editing controls", () => {
  mocks.mode = "video";
  mocks.project.draft.content.video = { mode: "video", ratio: "16:9", duration: 5, media: [], composition: null };
  mocks.project.draft.content.layers = [{ id: "result_1", type: "video", name: "Result", assetId: "asset_1" }];
  render(<Shell />);
  expect(screen.getByRole("link", { name: "Download MP4" }).getAttribute("href")).toBe("/api/assets/asset_1?download=1");
  expect(screen.queryByRole("button", { name: "Edit video" })).toBeNull();
  expect(screen.queryByLabelText("Storyboard table")).toBeNull();
});

it("clears portal controls when leaving the video workspace", () => {
  const { rerender } = render(<Shell />);
  expect(screen.getByLabelText("Project name")).not.toBeNull();
  rerender(<Shell workspace={false} />);
  expect(screen.queryByLabelText("Project name")).toBeNull();
  expect(screen.queryByRole("button", { name: "Toggle files" })).toBeNull();
});
