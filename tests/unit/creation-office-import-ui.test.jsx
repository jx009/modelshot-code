// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import OfficeImport from "../../src/components/creation/OfficeImport";
import { useRef } from "react";
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

function SlideWorkspace(props) {
  const root = useRef(null);
  return <form ref={root} data-testid="workspace" onSubmit={props.onSubmit}>
    <OfficeImport projectId="p" kind="slides" compact dropTarget={root} zh={false} {...props} />
  </form>;
}
const drop = files => fireEvent.drop(screen.getByTestId("workspace"), { dataTransfer: { types: ["Files"], files } });
const sizedFile = (name, size) => {
  const file = new File(["zip"], name);
  Object.defineProperty(file, "size", { value: size });
  return file;
};
it("accepts an 11 MiB dropped PPT and opens the editable result once without submitting the chat", async () => {
  const onSelect = vi.fn(), onImported = vi.fn(), onSubmit = vi.fn(event => event.preventDefault());
  const item = { id: "deck-import", status: "succeeded", artifactId: "deck", name: "deck.pptx", sourceUrl: "/source", warnings: [] };
  let uploaded = false;
  mocks.api.mockImplementation(async (_url, options = {}) => {
    if (options.method === "POST") { uploaded = true; return item; }
    return { enabled: true, maxBytes: 32 * 1024 * 1024, items: uploaded ? [item] : [] };
  });
  render(<SlideWorkspace onSelect={onSelect} onImported={onImported} onSubmit={onSubmit} />);
  await waitFor(() => expect(screen.getByLabelText("Import Office file").disabled).toBe(false));
  const file = sizedFile("deck.pptx", 11630042);
  fireEvent.dragEnter(screen.getByTestId("workspace"), { dataTransfer: { types: ["Files"] } });
  expect(screen.getByText("Drop to import PPT")).toBeTruthy();
  drop([file]);
  await waitFor(() => expect(onSelect).toHaveBeenCalledWith("deck", false, "slides"));
  expect(onImported).toHaveBeenCalledOnce();
  expect(onSelect).toHaveBeenCalledOnce();
  expect(screen.queryByText("Drop to import PPT")).toBeNull();
  const writes = mocks.api.mock.calls.filter(([, options]) => options?.method === "POST");
  expect(writes).toHaveLength(1);
  expect(writes[0][1].body.get("file")).toBe(file);
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  expect(onSubmit).not.toHaveBeenCalled();
});

it.each([
  ["too large", [sizedFile("big.pptx", 32 * 1024 * 1024 + 1)]],
  ["legacy format", [sizedFile("old.ppt", 100)]],
  ["multiple files", [sizedFile("a.pptx", 100), sizedFile("b.pptx", 100)]],
])("rejects %s before sending an import", async (_reason, files) => {
  mocks.api.mockResolvedValue({ enabled: true, items: [] });
  render(<SlideWorkspace />);
  await waitFor(() => expect(screen.getByLabelText("Import Office file").disabled).toBe(false));
  drop(files);
  await screen.findByRole("alert");
  expect(mocks.api.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(0);
});

it("keeps a completed import ready without replacing an edit started during upload", async () => {
  const onSelect = vi.fn(), onImported = vi.fn();
  const item = { id: "deck-import", status: "succeeded", artifactId: "deck", name: "deck.pptx", sourceUrl: "/source", warnings: [] };
  let finish, uploaded = false;
  mocks.api.mockImplementation(async (_url, options = {}) => {
    if (options.method === "POST") { await new Promise(resolve => { finish = resolve; }); uploaded = true; return item; }
    return { enabled: true, items: uploaded ? [item] : [] };
  });
  const view = render(<SlideWorkspace onSelect={onSelect} onImported={onImported} />);
  await waitFor(() => expect(screen.getByLabelText("Import Office file").disabled).toBe(false));
  drop([sizedFile("deck.pptx", 11630042)]);
  view.rerender(<SlideWorkspace disabled onSelect={onSelect} onImported={onImported} />);
  await act(async () => finish());
  await waitFor(() => expect(onImported).toHaveBeenCalledOnce());
  expect(onSelect).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Open" }).disabled).toBe(true);
  view.rerender(<SlideWorkspace onSelect={onSelect} onImported={onImported} />);
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  expect(onSelect).toHaveBeenCalledWith("deck", false, "slides");
});

it("does not upload when the import worker is unavailable", async () => {
  mocks.api.mockResolvedValue({ enabled: false, items: [] });
  render(<SlideWorkspace />);
  await screen.findByText(/Import service is unavailable/);
  drop([sizedFile("deck.pptx", 100)]);
  await screen.findByRole("alert");
  expect(mocks.api.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(0);
});
