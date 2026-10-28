// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import VideoLauncher from "../../src/components/video/VideoLauncher";

const mocks = vi.hoisted(() => ({ api: vi.fn(), push: vi.fn(), project: null }));
vi.mock("../../src/lib/client-api", () => ({ api: (...args) => mocks.api(...args) }));
vi.mock("../../src/hooks/useNavigationRouter", () => ({ useNavigationRouter: () => ({ push: mocks.push }) }));
vi.mock("../../src/components/video/useVideoProject", () => ({ default: () => mocks.project }));

beforeEach(() => {
  mocks.api.mockReset().mockResolvedValue({ tools: [{ id: "video", available: true, cost: 10 }, { id: "motion-plan", available: true, cost: 2 }] });
  mocks.push.mockReset();
  mocks.project = {
    draft: { content: { video: { ratio: "16:9", duration: 5, media: [], composition: null } } },
    change: vi.fn(), save: vi.fn().mockResolvedValue({ id: "document_1" }),
    upload: vi.fn(), submit: vi.fn().mockResolvedValue({ documentId: "document_1" }),
    working: false, active: false, applying: false, jobsLoading: false,
    recovery: null, error: "", uploadProgress: "",
  };
});
afterEach(cleanup);

it.each(["video", "motion"])("uses the shared composer with collapsed settings for %s", mode => {
  render(<VideoLauncher mode={mode} userId="user_1" zh={false} />);
  const form = screen.getByRole("textbox", { name: "Video prompt" }).closest("form");
  expect(form.className).toBe("cr-creation-launcher");
  expect(form.querySelector(".cr-creation-options>.cr-send")).not.toBeNull();
  expect(screen.getByLabelText("Aspect ratio").closest("details").open).toBe(false);
  expect(screen.getByText("Open video workspace").closest("details")).not.toBeNull();
  expect(document.querySelector(".vm-launcher")).toBeNull();
});

it("shows loading rather than unavailable while capabilities are pending", () => {
  mocks.api.mockReturnValue(new Promise(() => {}));
  render(<VideoLauncher mode="video" userId="user_1" zh={false} />);
  expect(screen.getByRole("status").textContent).toBe("Loading video availability…");
  expect(screen.queryByText(/Generation is unavailable/)).toBeNull();
  expect(screen.getByRole("textbox").disabled).toBe(false);
});

it("restores the homepage prompt and reports edits without saving a project", () => {
  const onDraft = vi.fn();
  render(<VideoLauncher mode="video" userId="user_1" zh={false} initialDraft={{ prompt: "A saved scene" }} onDraft={onDraft} />);
  const prompt = screen.getByRole("textbox");
  expect(prompt.value).toBe("A saved scene");
  fireEvent.change(prompt, { target: { value: "A revised scene" } });
  expect(onDraft).toHaveBeenLastCalledWith({ prompt: "A revised scene" });
  expect(mocks.project.save).not.toHaveBeenCalled();
});

it("changes the platform aspect preset without overwriting the prompt", () => {
  render(<VideoLauncher mode="motion" userId="user_1" zh={false} initialDraft={{ prompt: "Keep my story" }} />);
  fireEvent.click(screen.getByText("Settings"));
  fireEvent.change(screen.getByLabelText("Platform preset"), { target: { value: "0" } });
  expect(screen.getByRole("textbox").value).toBe("Keep my story");
  const update = mocks.project.change.mock.calls[0][0](mocks.project.draft);
  expect(update.content.video.ratio).toBe("9:16");
});

it.each([["video", "video", 10], ["motion", "motion-plan", 2]])("keeps the existing %s generation contract", async (mode, tool, cost) => {
  render(<VideoLauncher mode={mode} userId="user_1" zh={false} initialDraft={{ prompt: "A cinematic scene" }} />);
  const submit = screen.getByRole("button", { name: mode === "video" ? "Generate video" : "Generate video plan" });
  await waitFor(() => expect(submit.disabled).toBe(false));
  fireEvent.click(submit);
  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/video?document=document_1"));
  expect(mocks.project.submit).toHaveBeenCalledWith(tool, "A cinematic scene", { id: tool, available: true, cost });
});

it("accepts a pasted first frame through the composer", () => {
  render(<VideoLauncher mode="video" userId="user_1" zh={false} />);
  const file = new File(["image"], "frame.png", { type: "image/png" });
  fireEvent.paste(screen.getByRole("textbox"), { clipboardData: { files: [file] } });
  expect(mocks.project.upload).toHaveBeenCalledWith([file]);
});

it("submits the selected video model and its quote, keeping it in the project draft", async () => {
  mocks.project.draft.content.video.provider = "selected";
  mocks.api.mockResolvedValue({ videoProvider: "default", videoModels: [{ id: "selected", label: "Video Pro", cost: 24, available: true }], tools: [{ id: "video", cost: 10, available: true }] });
  render(<VideoLauncher mode="video" userId="user_1" zh={false} initialDraft={{ prompt: "A scene" }} />);
  const submit = screen.getByRole("button", { name: "Generate video" });
  await waitFor(() => expect(submit.disabled).toBe(false));
  fireEvent.click(screen.getByText("Settings"));
  expect(screen.getByLabelText("Video model").value).toBe("selected");
  fireEvent.click(submit);
  await waitFor(() => expect(mocks.project.submit).toHaveBeenCalledWith("video", "A scene", expect.objectContaining({ provider: "selected", cost: 24 })));
});

it("preserves multiline and IME input without submitting", async () => {
  render(<VideoLauncher mode="video" userId="user_1" zh={false} initialDraft={{ prompt: "A scene" }} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Generate video" }).disabled).toBe(false));
  const prompt = screen.getByRole("textbox");
  fireEvent.keyDown(prompt, { key: "Enter", shiftKey: true });
  fireEvent.keyDown(prompt, { key: "Enter", isComposing: true });
  fireEvent.keyDown(prompt, { key: "Enter", keyCode: 229 });
  fireEvent.keyDown(prompt, { key: "Enter", repeat: true });
  expect(mocks.project.submit).not.toHaveBeenCalled();
});

it("retries a failed capability request", async () => {
  mocks.api.mockRejectedValueOnce(new Error("network"));
  render(<VideoLauncher mode="video" userId="user_1" zh={false} />);
  fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(mocks.api).toHaveBeenCalledTimes(2);
});

it("does not request video capabilities for a signed-out or hidden homepage", () => {
  const { rerender } = render(<VideoLauncher mode="video" zh={false} />);
  expect(mocks.api).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Generate video" }).disabled).toBe(true);
  rerender(<VideoLauncher mode="video" userId="user_1" zh={false} visible={false} />);
  expect(mocks.api).not.toHaveBeenCalled();
});

it("does not redirect a hidden homepage when a submission completes", async () => {
  let finish;
  mocks.project.submit.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const { rerender } = render(<VideoLauncher mode="video" userId="user_1" zh={false} initialDraft={{ prompt: "A scene" }} />);
  const submit = screen.getByRole("button", { name: "Generate video" });
  await waitFor(() => expect(submit.disabled).toBe(false));
  fireEvent.click(submit);
  rerender(<VideoLauncher mode="video" userId="user_1" zh={false} visible={false} />);
  finish({ documentId: "document_1" });
  await Promise.resolve();
  expect(mocks.push).not.toHaveBeenCalled();
});
