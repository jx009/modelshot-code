// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Activity, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ReferenceFiles from "../../src/components/creation/ReferenceFiles";

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("../../src/lib/client-api", () => ({ api: (...args) => mocks.api(...args) }));
vi.mock("../../src/components/creation/ReferenceAssets", () => ({ referenceAssetIds: value => [...new Set(value || [])].slice(0, 8) }));
const row = { id: "ref", name: "brief.md", fileType: "md", bytes: 30 };
const onError = vi.fn();
function Harness({ sessionId = "s" }) {
  const [value, setValue] = useState([]);
  return <><ReferenceFiles sessionId={sessionId} value={value} onChange={setValue} zh={false} onError={onError} /><output data-testid="selected">{value.join(",")}</output></>;
}
beforeEach(() => { onError.mockReset(); mocks.api.mockReset().mockResolvedValue({ items: [row] }); });
afterEach(cleanup);

it("reuses uploaded files after deselection without uploading them again", async () => {
  render(<Harness />);
  fireEvent.click(await screen.findByText("Use brief.md"));
  expect(screen.getByTestId("selected").textContent).toBe("ref");
  fireEvent.click(screen.getByLabelText("Remove reference file 1"));
  expect(screen.getByTestId("selected").textContent).toBe("");
  fireEvent.click(screen.getByText("Use brief.md"));
  expect(screen.getByTestId("selected").textContent).toBe("ref");
  expect(mocks.api).toHaveBeenCalledOnce();
});

it("uploads selected files serially and adds their IDs to the draft", async () => {
  let active = 0, peak = 0, number = 0;
  mocks.api.mockImplementation(async (_url, options) => {
    if (options?.method !== "POST") return { items: [] };
    active++; peak = Math.max(peak, active);
    expect(options.body).toBeInstanceOf(FormData);
    await Promise.resolve(); active--;
    return { item: { ...row, id: `ref${++number}` } };
  });
  render(<Harness />);
  await waitFor(() => expect(screen.getByLabelText("Upload reference documents").disabled).toBe(false));
  fireEvent.change(screen.getByLabelText("Upload reference documents"), { target: { files: [new File(["a"], "a.md"), new File(["b"], "b.md")] } });
  await waitFor(() => expect(screen.getByTestId("selected").textContent).toBe("ref1,ref2"));
  expect(peak).toBe(1);
});

it("cancels the old upload and ignores its result when the session changes", async () => {
  let resolve, signal;
  mocks.api.mockImplementation(async (_url, options) => {
    if (options?.method !== "POST") return { items: [] };
    signal = options.signal;
    return new Promise(done => { resolve = done; });
  });
  const view = render(<Harness />);
  await waitFor(() => expect(screen.getByLabelText("Upload reference documents").disabled).toBe(false));
  fireEvent.change(screen.getByLabelText("Upload reference documents"), { target: { files: [new File(["a"], "a.md")] } });
  await waitFor(() => expect(signal).toBeDefined());
  view.rerender(<Harness sessionId="other" />);
  expect(signal.aborted).toBe(true);
  await act(async () => resolve({ item: row }));
  expect(screen.getByTestId("selected").textContent).toBe("");
  expect(screen.queryByText("brief.md")).toBeNull();
});

it("shows Office choices only when supported, validates sizes before upload and links retained originals", async () => {
  mocks.api.mockResolvedValueOnce({ items: [{ ...row, name: "资料.docx", fileType: "docx" }], officeEnabled: true });
  render(<Harness />);
  fireEvent.click(await screen.findByText("Use 资料.docx"));
  const input = screen.getByLabelText("Upload reference documents");
  expect(input.accept).toContain(".docx,.xlsx,.pptx");
  expect(screen.getByRole("link", { name: "Download original 资料.docx" }).getAttribute("href")).toBe("/api/creation/sessions/s/references/ref");
  fireEvent.change(input, { target: { files: [{ name: "large.docx", size: 4 * 1024 * 1024 + 1 }] } });
  expect(onError).toHaveBeenCalledWith({ code: "CREATION_REFERENCE_TOO_LARGE" });
  expect(mocks.api).toHaveBeenCalledOnce();
});

it("does not upload unsupported Office files when capability is unavailable", async () => {
  render(<Harness />);
  const input = screen.getByLabelText("Upload reference documents");
  await waitFor(() => expect(input.disabled).toBe(false));
  expect(input.accept).not.toContain(".docx");
  fireEvent.change(input, { target: { files: [new File(["source"], "a.docx")] } });
  expect(onError).toHaveBeenCalledWith({ code: "CREATION_REFERENCE_TYPE_UNSUPPORTED" }); expect(mocks.api).toHaveBeenCalledOnce();
});

it("recovers upload controls after Activity interrupts an upload and ignores its late result", async () => {
  let resolve, signal;
  mocks.api.mockImplementation(async (_url, options) => {
    if (options?.method !== "POST") return { items: [] };
    signal = options.signal; return new Promise(done => { resolve = done; });
  });
  const view = render(<Activity mode="visible"><Harness /></Activity>);
  const input = screen.getByLabelText("Upload reference documents");
  await waitFor(() => expect(input.disabled).toBe(false));
  fireEvent.change(input, { target: { files: [new File(["a"], "a.md")] } });
  await waitFor(() => expect(signal).toBeDefined());
  view.rerender(<Activity mode="hidden"><Harness /></Activity>); expect(signal.aborted).toBe(true);
  view.rerender(<Activity mode="visible"><Harness /></Activity>);
  await waitFor(() => expect(screen.getByLabelText("Upload reference documents").disabled).toBe(false));
  await act(async () => resolve({ item: row }));
  expect(screen.getByTestId("selected").textContent).toBe("");
});
