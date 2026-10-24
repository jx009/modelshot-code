// @vitest-environment jsdom
import { Activity } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePendingTextDraft } from "../../src/components/creation/usePendingTextDraft";

const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), stored: null }));
vi.mock("../../src/lib/creation/client/drafts", () => ({ readArtifactTextDraft: (...args) => mocks.read(...args), writeArtifactTextDraft: (...args) => mocks.write(...args) }));
const draft = { pageId: "p", nodeId: "n", original: "Original", text: "Typed", composing: true };
const persistOperations = async () => {};
function Harness() {
  const journal = usePendingTextDraft("u", "a", persistOperations);
  return <><button disabled={!journal.ready} onClick={() => journal.change(draft)}>Type</button><output>{journal.recovery?.text || "none"}</output>{journal.error && <button onClick={journal.retry}>Retry</button>}</>;
}
beforeEach(() => {
  mocks.stored = null; mocks.read.mockReset().mockImplementation(async () => mocks.stored);
  mocks.write.mockReset().mockImplementation(async (_user, _id, value, prepare) => { await prepare(); mocks.stored = value; });
});
afterEach(cleanup);
it("persists on Activity hide and blocks retained inputs until recovery finishes on return", async () => {
  const { rerender } = render(<Activity mode="visible"><Harness /></Activity>);
  await waitFor(() => expect(screen.getByText("Type").disabled).toBe(false)); fireEvent.click(screen.getByText("Type"));
  await act(async () => rerender(<Activity mode="hidden"><Harness /></Activity>));
  expect(mocks.stored).toEqual(draft);
  let release; mocks.read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await act(async () => rerender(<Activity mode="visible"><Harness /></Activity>));
  expect(screen.getByText("Type").disabled).toBe(true);
  await act(async () => release(mocks.stored));
  expect(screen.getByText("Type").disabled).toBe(false); expect(screen.getByText("Typed")).toBeTruthy();
});
it("keeps cloud input available on failed local recovery reads and retries local storage", async () => {
  mocks.read.mockRejectedValueOnce(new Error("Disk blocked")); render(<Harness />);
  await screen.findByText("Retry"); expect(screen.getByText("Type").disabled).toBe(false);
  fireEvent.click(screen.getByText("Retry"));
  await waitFor(() => expect(screen.getByText("Type").disabled).toBe(false));
  expect(mocks.write).not.toHaveBeenCalled(); expect(screen.queryByText("Retry")).toBeNull();
});
