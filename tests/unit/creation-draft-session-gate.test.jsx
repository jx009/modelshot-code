// @vitest-environment jsdom
import { createRef } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import DraftSessionGate from "../../src/components/creation/DraftSessionGate";
const mocks = vi.hoisted(() => ({ list: vi.fn(), copy: vi.fn(), remove: vi.fn(), remember: vi.fn(), remembered: vi.fn() }));
vi.mock("../../src/lib/creation/client/drafts", () => ({ listArtifactDraftSessions: (...args) => mocks.list(...args), copyArtifactDraftSession: (...args) => mocks.copy(...args), removeArtifactDraftSession: (...args) => mocks.remove(...args) }));
vi.mock("../../src/lib/creation/client/draft-session", () => ({ creationDraftSession: () => "current-session-12345", rememberedDraftSession: (...args) => mocks.remembered(...args), rememberDraftSession: (...args) => mocks.remember(...args), newDraftBranch: () => "recovery-session-1234" }));
const item = { sessionId: "source-session-12345", updatedAt: 1000, token: "version-one", dirty: true, hasText: true };
const child = sessionId => <div>Editor {sessionId}</div>;
beforeEach(() => { Object.values(mocks).forEach(mock => mock.mockReset()); mocks.list.mockResolvedValue({ own: false, items: [item] }); mocks.copy.mockResolvedValue(undefined); mocks.remove.mockResolvedValue(undefined); });
afterEach(cleanup);
it("reopens a chosen branch immediately and lists other branches only on explicit request", async () => {
  mocks.remembered.mockReturnValue("chosen-session");
  render(<DraftSessionGate userId="u" artifactId="a" zh={false}>{(id, pick) => <><span>Editor {id}</span><button onClick={pick}>Other drafts</button></>}</DraftSessionGate>);
  await screen.findByText("Editor chosen-session");
  expect(mocks.list).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Other drafts"));
  await screen.findByText("Recover draft");
  expect(mocks.list).toHaveBeenCalledWith("u", "a", "chosen-session");
});
it("waits for a recovery choice before mounting the editor or allowing dependent saves", async () => {
  const ref = createRef(); render(<DraftSessionGate userId="u" artifactId="a" zh={false} editorRef={ref}>{child}</DraftSessionGate>);
  await screen.findByText("Recover draft");
  expect(screen.queryByText(/Editor current/)).toBeNull(); expect(mocks.copy).not.toHaveBeenCalled();
  await expect(ref.current.flush()).rejects.toThrow("LOCAL_DRAFT_SELECTION_REQUIRED");
  fireEvent.click(screen.getByText("Recover draft"));
  await screen.findByText("Editor recovery-session-1234");
  expect(mocks.copy).toHaveBeenCalledExactlyOnceWith("u", "a", item, "recovery-session-1234"); expect(mocks.remove).not.toHaveBeenCalled();
});
it("opens the cloud/current branch by explicit choice without copying or deleting another branch", async () => {
  render(<DraftSessionGate userId="u" artifactId="a" zh={false}>{child}</DraftSessionGate>);
  fireEvent.click(await screen.findByText("Open current version")); await screen.findByText("Editor current-session-12345");
  expect(mocks.copy).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled(); expect(mocks.remember).toHaveBeenCalledWith("u", "a", "current-session-12345");
});
it("requires a second explicit action to remove a draft and sends the displayed snapshot token", async () => {
  render(<DraftSessionGate userId="u" artifactId="a" zh={false}>{child}</DraftSessionGate>);
  fireEvent.click(await screen.findByText("Remove")); expect(mocks.remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Cancel")); expect(mocks.remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Remove")); mocks.list.mockResolvedValue({ own: false, items: [] });
  await act(async () => fireEvent.click(screen.getByText("Confirm removal")));
  expect(mocks.remove).toHaveBeenCalledExactlyOnceWith("u", "a", item);
});
it("keeps the picker on a concurrent change and requires refreshed metadata before retrying", async () => {
  mocks.copy.mockRejectedValueOnce(new Error("LOCAL_DRAFT_CHANGED"));
  render(<DraftSessionGate userId="u" artifactId="a" zh={false}>{child}</DraftSessionGate>);
  fireEvent.click(await screen.findByText("Recover draft")); await screen.findByRole("alert"); expect(screen.queryByText(/Editor current/)).toBeNull();
  mocks.list.mockResolvedValue({ own: false, items: [{ ...item, token: "version-two" }] });
  fireEvent.click(screen.getByText("Refresh drafts")); await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  fireEvent.click(screen.getByText("Recover draft")); await screen.findByText("Editor recovery-session-1234");
  expect(mocks.copy.mock.calls.at(-1)[2].token).toBe("version-two");
});
it("reopens its own branch without presenting or automatically importing another session", async () => {
  mocks.list.mockResolvedValue({ own: true, items: [item] }); render(<DraftSessionGate userId="u" artifactId="a" zh={false}>{child}</DraftSessionGate>);
  await screen.findByText("Editor current-session-12345"); expect(mocks.copy).not.toHaveBeenCalled();
});
it("allows opening the cloud version when local storage is unavailable", async () => {
  mocks.list.mockRejectedValueOnce(Object.assign(new Error("IndexedDB blocked"), { code: "LOCAL_DRAFT_UNAVAILABLE" }));
  render(<DraftSessionGate userId="u" artifactId="a" zh={false}>{child}</DraftSessionGate>);
  await screen.findByRole("alert"); expect(screen.getByText("Local drafts are unavailable, but you can still edit the cloud version.")).toBeTruthy();
  fireEvent.click(screen.getByText("Open current version")); await screen.findByText("Editor current-session-12345");
  expect(mocks.copy).not.toHaveBeenCalled();
});
