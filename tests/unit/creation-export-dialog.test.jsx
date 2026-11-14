// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Activity } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ExportDialog from "../../src/components/creation/ExportDialog";

const mock = vi.hoisted(() => ({ api: vi.fn(), sequence: 0 }));
vi.mock("../../src/lib/client-api", () => ({ api: (...args) => mock.api(...args), requestKey: () => `export-retry-key-${++mock.sequence}` }));
vi.mock("../../src/components/ui/Modal", () => ({ default: ({ children }) => <div role="dialog">{children}</div> }));
beforeEach(() => { sessionStorage.clear(); mock.api.mockReset(); Object.defineProperty(document, "hidden", { configurable: true, value: false }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
const props = onFlush => ({ artifactId: "artifact", userId: "user", zh: false, onFlush, onClose: vi.fn() });

it("offers PDF for slides, freezes its saved revision across remounts and retries a historical PDF independently of PPTX", async () => {
  const flush = vi.fn(async () => ({ revision: 16 })), submitted = [];
  mock.api.mockImplementation(async (_url, options) => {
    if (options?.method === "POST") { submitted.push(options.body); if (submitted.length === 1) throw new Error("network"); return { id: "pdf" }; }
    return { formats: [{ format: "pptx", enabled: false }, { format: "pdf", enabled: true }], items: [{ id: "old", format: "pdf", revision: 4, attempt: 2, status: "failed", canRetry: true }] };
  });
  render(<ExportDialog {...props(flush)} />);
  fireEvent.change(screen.getByLabelText("Export format"), { target: { value: "pdf" } });
  await waitFor(() => expect(screen.getByText("Save and export PDF").disabled).toBe(false));
  expect(screen.getByText(/hidden slides and speaker notes are omitted/)).toBeTruthy();
  fireEvent.click(screen.getByText("Save and export PDF")); await screen.findByText("Recover submission");
  expect(screen.getByLabelText("Export format").disabled).toBe(true);
  cleanup();
  const newFlush = vi.fn(); render(<ExportDialog {...props(newFlush)} />);
  expect(screen.getByText(/hidden slides and speaker notes are omitted/)).toBeTruthy();
  fireEvent.click(await screen.findByText("Recover submission"));
  await waitFor(() => expect(submitted).toHaveLength(2));
  expect(submitted).toEqual([{ revision: 16, format: "pdf" }, { revision: 16, format: "pdf" }]);
  fireEvent.click(screen.getByText("Retry this version"));
  await waitFor(() => expect(submitted).toHaveLength(3));
  expect(submitted[2]).toMatchObject({ revision: 4, format: "pdf", retryAttempt: 2 });
  expect(flush).toHaveBeenCalledOnce(); expect(newFlush).not.toHaveBeenCalled();
});

it("recovers an in-flight export after Activity reconnect without letting stale completion unlock a new request", async () => {
  const flush = vi.fn(async () => ({ revision: 7 })), responses = [], submitted = [];
  mock.api.mockImplementation(async (_url, options) => {
    if (options?.method === "POST") { submitted.push(options.body); return new Promise(resolve => responses.push(resolve)); }
    return { enabled: true, items: [] };
  });
  const p = props(flush), show = mode => <Activity mode={mode}><ExportDialog {...p} /></Activity>;
  const view = render(show("visible"));
  await waitFor(() => expect(screen.getByText("Save and export PPTX").disabled).toBe(false));
  fireEvent.click(screen.getByText("Save and export PPTX")); await waitFor(() => expect(responses).toHaveLength(1));
  view.rerender(show("hidden")); view.rerender(show("visible"));
  await waitFor(() => expect(screen.getByText("Recover submission").disabled).toBe(false));
  fireEvent.click(screen.getByText("Recover submission")); await waitFor(() => expect(responses).toHaveLength(2));
  await act(async () => responses[0]({ id: "export" }));
  expect(screen.getByText("Recover submission").disabled).toBe(true);
  expect(sessionStorage.getItem("creation-export:user:artifact")).not.toBeNull();
  await act(async () => responses[1]({ id: "export" }));
  expect(sessionStorage.getItem("creation-export:user:artifact")).toBeNull();
  expect(submitted).toEqual([{ revision: 7, format: "pptx" }, { revision: 7, format: "pptx" }]);
  expect(flush).toHaveBeenCalledOnce();
});

it("does not submit on opening and freezes the flushed version for recovery after a lost response", async () => {
  const flush = vi.fn(async () => ({ revision: 7 })), submitted = [];
  mock.api.mockImplementation(async (_url, options) => {
    if (options?.method === "POST") { submitted.push(options.body); if (submitted.length === 1) throw new Error("network"); return { id: "export" }; }
    return { enabled: true, items: [] };
  });
  render(<ExportDialog {...props(flush)} />);
  await waitFor(() => expect(screen.getByText("Save and export PPTX").disabled).toBe(false));
  expect(flush).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Save and export PPTX"));
  await screen.findByText("Recover submission");
  expect(submitted).toEqual([{ revision: 7, format: "pptx" }]);
  cleanup();
  const newFlush = vi.fn(async () => ({ revision: 8 }));
  render(<ExportDialog {...props(newFlush)} />);
  fireEvent.click(await screen.findByText("Recover submission"));
  await waitFor(() => expect(submitted).toHaveLength(2));
  expect(submitted[1]).toEqual(submitted[0]);
  expect(newFlush).not.toHaveBeenCalled();
});

it("does not submit when pending text cannot be flushed and retains downloads when admission is disabled", async () => {
  mock.api.mockResolvedValue({ enabled: true, items: [] });
  render(<ExportDialog {...props(async () => { throw new Error("TEXT_COMPOSITION_ACTIVE"); })} />);
  await waitFor(() => expect(screen.getByText("Save and export PPTX").disabled).toBe(false));
  fireEvent.click(screen.getByText("Save and export PPTX"));
  await screen.findByRole("alert");
  expect(mock.api.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);
  cleanup();
  mock.api.mockResolvedValue({ enabled: false, items: [{ id: "done", format: "pptx", revision: 2, status: "succeeded", downloadUrl: "/api/creation/exports/done/download" }] });
  render(<ExportDialog {...props(vi.fn())} />);
  const download = await screen.findByText("Download");
  expect(download.getAttribute("href")).toBe("/api/creation/exports/done/download");
  expect(screen.getByText("Save and export PPTX").disabled).toBe(true);
});

it("polls only while visible and stops after unmount", async () => {
  vi.useFakeTimers();
  mock.api.mockResolvedValue({ enabled: true, items: [{ id: "active", revision: 1, status: "running" }] });
  const view = render(<ExportDialog {...props(vi.fn())} />);
  await act(async () => {});
  expect(mock.api).toHaveBeenCalledTimes(1);
  Object.defineProperty(document, "hidden", { configurable: true, value: true });
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  expect(mock.api).toHaveBeenCalledTimes(1);
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(mock.api).toHaveBeenCalledTimes(2);
  view.unmount();
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  expect(mock.api).toHaveBeenCalledTimes(2);
});

it("freezes poster format and revision after a lost response, then retries an older JPEG without flushing", async () => {
  const flush = vi.fn(async () => ({ revision: 9 })), submitted = [];
  mock.api.mockImplementation(async (_url, options) => {
    if (options?.method === "POST") { submitted.push(options.body); if (submitted.length === 1) throw new Error("network"); return { id: "saved" }; }
    return { enabled: true, formats: [{ format: "png", enabled: true }, { format: "jpeg", enabled: true }], items: [{ id: "old", format: "jpeg", revision: 3, attempt: 2, status: "failed" }] };
  });
  render(<ExportDialog {...props(flush)} kind="poster" />);
  await waitFor(() => expect(screen.getByText("Save and export PNG").disabled).toBe(false));
  fireEvent.change(screen.getByLabelText("Export format"), { target: { value: "jpeg" } });
  fireEvent.click(screen.getByText("Save and export JPEG"));
  await screen.findByText("Recover submission");
  expect(screen.getByLabelText("Export format").disabled).toBe(true);
  expect(submitted[0]).toEqual({ revision: 9, format: "jpeg" });
  fireEvent.click(screen.getByText("Recover submission"));
  await waitFor(() => expect(screen.getByText("Retry this version").disabled).toBe(false));
  expect(submitted[1]).toEqual(submitted[0]);
  fireEvent.change(screen.getByLabelText("Export format"), { target: { value: "png" } });
  fireEvent.click(screen.getByText("Retry this version"));
  await waitFor(() => expect(submitted).toHaveLength(3));
  expect(submitted[2]).toMatchObject({ revision: 3, format: "jpeg", retryAttempt: 2 });
  expect(flush).toHaveBeenCalledOnce();
});

it("checks admission by selected format while retaining completed poster downloads", async () => {
  mock.api.mockResolvedValue({ enabled: true, formats: [{ format: "png", enabled: false }, { format: "jpeg", enabled: true }], items: [{ id: "done", format: "png", revision: 4, status: "succeeded", downloadUrl: "/api/creation/exports/done/download" }] });
  render(<ExportDialog {...props(vi.fn())} kind="poster" />);
  await screen.findByText("PNG · V4");
  expect(screen.getByText("Save and export PNG").disabled).toBe(true);
  expect(screen.getByText("Download").getAttribute("href")).toContain("/done/download");
  fireEvent.change(screen.getByLabelText("Export format"), { target: { value: "jpeg" } });
  expect(screen.getByText("Save and export JPEG").disabled).toBe(false);
});

it("shows SVG fidelity boundaries and recovers the same saved SVG version after a lost response", async () => {
  const flush = vi.fn(async () => ({ revision: 15 })), submitted = [];
  mock.api.mockImplementation(async (_url, options) => {
    if (options?.method === "POST") { submitted.push(options.body); if (submitted.length === 1) throw new Error("network"); return { id: "vector" }; }
    return { formats: [{ format: "png", enabled: false }, { format: "svg", enabled: true }], items: [] };
  });
  render(<ExportDialog {...props(flush)} kind="poster" />);
  fireEvent.change(screen.getByLabelText("Export format"), { target: { value: "svg" } });
  await waitFor(() => expect(screen.getByText("Save and export SVG").disabled).toBe(false));
  expect(screen.getByText(/Text is not outlined and fonts are not embedded/)).toBeTruthy();
  expect(screen.queryByText(/up to 8 million pixels/)).toBeNull();
  fireEvent.click(screen.getByText("Save and export SVG"));
  await screen.findByText("Recover submission");
  cleanup();
  const newFlush = vi.fn(async () => ({ revision: 16 }));
  render(<ExportDialog {...props(newFlush)} kind="poster" />);
  expect(screen.getByLabelText("Export format").value).toBe("svg");
  fireEvent.click(await screen.findByText("Recover submission"));
  await waitFor(() => expect(submitted).toHaveLength(2));
  expect(submitted).toEqual([{ revision: 15, format: "svg" }, { revision: 15, format: "svg" }]);
  expect(newFlush).not.toHaveBeenCalled();
});
