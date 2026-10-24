// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import OfficeImport from "../../src/components/creation/OfficeImport";
const mocks = vi.hoisted(() => ({ api: vi.fn(), key: vi.fn(() => "fixed-upload-key-123") }));
vi.mock("../../src/lib/client-api", () => ({ api: (...args) => mocks.api(...args), requestKey: () => mocks.key() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("retries an uncertain upload with the same file/key and opens the completed artifact", async () => {
  let posts = 0;
  const item = { id: "import", status: "succeeded", artifactId: "artifact", name: "预算.xlsx", sourceUrl: "/source", warnings: [] };
  mocks.api.mockImplementation(async (_url, options = {}) => {
    if (options.method === "POST") { if (++posts === 1) throw new Error("REQUEST_FAILED"); return item; }
    return { enabled: true, items: posts > 1 ? [item] : [] };
  });
  const onSelect = vi.fn(), onImported = vi.fn();
  render(<OfficeImport projectId="p" kind="sheet" zh={false} onSelect={onSelect} onImported={onImported} />);
  const input = screen.getByLabelText("Import Office file");
  await waitFor(() => expect(input.disabled).toBe(false));
  const file = new File(["zip"], "预算.xlsx");
  fireEvent.change(input, { target: { files: [file] } });
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  fireEvent.click(await screen.findByRole("button", { name: "Open" }));
  expect(onSelect).toHaveBeenCalledWith("artifact");
  const writes = mocks.api.mock.calls.filter(([, options]) => options?.method === "POST");
  expect(writes).toHaveLength(2);
  expect(writes[0][1].key).toBe(writes[1][1].key);
  expect(writes[0][1].body.get("file")).toBe(writes[1][1].body.get("file"));
  await waitFor(() => expect(onImported).toHaveBeenCalledOnce());
});
it("aborts pending status reads on unmount and refuses oversized uploads before sending", async () => {
  mocks.api.mockResolvedValue({ enabled: true, items: [] });
  const view = render(<OfficeImport projectId="p" kind="document" zh={false} />);
  const input = screen.getByLabelText("Import Office file");
  await waitFor(() => expect(input.disabled).toBe(false));
  const file = new File(["x"], "large.docx"); Object.defineProperty(file, "size", { value: 4194305 });
  fireEvent.change(input, { target: { files: [file] } });
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(mocks.api).toHaveBeenCalledTimes(1);
  const signal = mocks.api.mock.calls[0][1].signal;
  act(() => view.unmount());
  expect(signal.aborted).toBe(true);
});
