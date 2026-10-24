// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Activity } from "react";
import ProjectFiles from "../../src/components/creation/ProjectFiles";

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("../../src/lib/client-api", () => ({ api: (...args) => mocks.api(...args) }));
const file = (id, name, kind = "document") => ({ id, name, kind, currentRevision: 3 });
const project = { id: "p", name: "Launch", artifacts: [file("a", "Original report")], artifactsNextCursor: "original-cursor" };
function setup() {
  const select = vi.fn();
  return { ...render(<ProjectFiles project={project} fileId="a" onSelect={select} zh={false} />), select };
}
function search(value) {
  fireEvent.change(screen.getByLabelText("File name"), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Search", exact: true }));
}
beforeEach(() => { mocks.api.mockReset(); });
afterEach(cleanup);

it("uses initial metadata without fetching and searches the project only on explicit submit", async () => {
  mocks.api.mockResolvedValue({ items: [file("b", "Budget", "sheet")], nextCursor: "budget-cursor" });
  const { select } = setup();
  fireEvent.change(screen.getByLabelText("File name"), { target: { value: " Budget " } });
  expect(mocks.api).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Search", exact: true }));
  const result = await screen.findByRole("button", { name: "Budget V3" });
  expect(mocks.api.mock.calls[0][0]).toBe("/api/creation/projects/p/files?q=Budget");
  expect(screen.queryByText("Original report")).toBeNull();
  fireEvent.click(result); expect(select).toHaveBeenCalledWith("b");
  mocks.api.mockResolvedValue({ items: [file("c", "Budget 2", "sheet")], nextCursor: null });
  fireEvent.click(screen.getByLabelText("Next file page"));
  await screen.findByText("Budget 2");
  expect(mocks.api.mock.calls[1][0]).toBe("/api/creation/projects/p/files?cursor=budget-cursor&q=Budget");
  expect(screen.getByText("Page 2")).toBeTruthy();
});

it("aborts superseded searches and ignores late responses without replacing the latest page", async () => {
  const requests = [];
  mocks.api.mockImplementation((url, options) => new Promise(resolve => requests.push({ url, ...options, resolve })));
  const view = setup(); search("old"); search("new");
  expect(requests[0].signal.aborted).toBe(true);
  await act(async () => requests[1].resolve({ items: [file("n", "New result")], nextCursor: null }));
  await act(async () => requests[0].resolve({ items: [file("o", "Old result")], nextCursor: null }));
  expect(screen.getByText("New result")).toBeTruthy(); expect(screen.queryByText("Old result")).toBeNull();
  search("pending"); view.unmount(); expect(requests[2].signal.aborted).toBe(true);
  await act(async () => requests[2].resolve({ items: [], nextCursor: null }));
});

it("retains the last page on failure and retries the failed query even if the input changes", async () => {
  mocks.api.mockRejectedValueOnce(new Error("NETWORK_ERROR"));
  setup(); search("Budget"); await screen.findByRole("alert");
  expect(screen.getByText("Original report")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("File name"), { target: { value: "Unsubmitted" } });
  mocks.api.mockResolvedValueOnce({ items: [], nextCursor: null });
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText("No matching files");
  expect(mocks.api.mock.calls[1][0]).toBe("/api/creation/projects/p/files?q=Budget");
  mocks.api.mockResolvedValueOnce({ items: project.artifacts, nextCursor: "fresh-cursor" });
  fireEvent.click(screen.getByLabelText("Clear file search"));
  await screen.findByText("Original report");
  expect(screen.getByLabelText("File name").value).toBe("");
  expect(mocks.api.mock.calls[2][0]).toBe("/api/creation/projects/p/files");
  expect(screen.getByText("Page 1")).toBeTruthy();
});

it("keeps pagination on the applied query until the edited search is submitted", async () => {
  mocks.api.mockResolvedValueOnce({ items: [file("s", "Search result")], nextCursor: "search-cursor" });
  setup(); search("first"); await screen.findByText("Search result");
  fireEvent.change(screen.getByLabelText("File name"), { target: { value: "draft" } });
  mocks.api.mockResolvedValueOnce({ items: [], nextCursor: null });
  fireEvent.click(screen.getByLabelText("Next file page"));
  await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
  expect(mocks.api.mock.calls[1][0]).toBe("/api/creation/projects/p/files?cursor=search-cursor&q=first");
});

it("unlocks an interrupted page on Activity reopen and ignores the old completion", async () => {
  let finish, signal;
  mocks.api.mockImplementationOnce((url, options) => { signal = options.signal; return new Promise(resolve => { finish = resolve; }); });
  const panel = mode => <Activity mode={mode}><ProjectFiles project={project} fileId="a" onSelect={() => {}} zh={false} /></Activity>;
  const view = render(panel("visible"));
  fireEvent.click(screen.getByLabelText("Next file page"));
  expect(screen.getByLabelText("Next file page").disabled).toBe(true);
  view.rerender(panel("hidden")); expect(signal.aborted).toBe(true);
  view.rerender(panel("visible"));
  await waitFor(() => expect(screen.getByLabelText("Next file page").disabled).toBe(false));
  mocks.api.mockResolvedValueOnce({ items: [file("new", "Reopened result")], nextCursor: null });
  fireEvent.click(screen.getByLabelText("Next file page")); await screen.findByText("Reopened result");
  await act(async () => finish({ items: [file("old", "Interrupted result")], nextCursor: null }));
  expect(screen.queryByText("Interrupted result")).toBeNull(); expect(screen.getByText("Reopened result")).toBeTruthy();
});
