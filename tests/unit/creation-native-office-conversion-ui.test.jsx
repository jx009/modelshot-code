// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Activity } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import NativeOfficeConversion from "../../src/components/creation/NativeOfficeConversion";
const ports = vi.hoisted(() => ({ api: vi.fn(), key: vi.fn() }));
vi.mock("../../src/lib/client-api", () => ({ api: (...args) => ports.api(...args), requestKey: () => ports.key() }));
const journalKey = "creation-native-copy:u:a";
const result = { artifactId: "copy", revision: 1, sourceArtifactId: "a", sourceRevision: 3 };
const props = () => ({ artifactId: "a", userId: "u", enabled: true, zh: false, editorRef: { current: { flush: vi.fn(async () => ({ revision: 3 })) } }, onArtifactCreated: vi.fn(), onOpenArtifact: vi.fn() });
beforeEach(() => { sessionStorage.clear(); vi.resetAllMocks(); ports.key.mockReturnValue("conversion-key-123456"); ports.api.mockResolvedValue(result); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("saves the source before journaling and posting, retains the source and opens the copy only on request", async () => {
  const p = props(), order = [];
  p.editorRef.current.flush.mockImplementation(async () => { order.push("save source"); return { revision: 3 }; });
  ports.api.mockImplementation(async (_path, { body }) => { order.push("convert"); expect(JSON.parse(sessionStorage.getItem(journalKey)).request).toEqual(body); return result; });
  render(<NativeOfficeConversion {...p} />);
  fireEvent.click(screen.getByRole("button", { name: "Create advanced editing copy" }));
  const open = await screen.findByRole("button", { name: "Open copy" });
  expect(order).toEqual(["save source", "convert"]); expect(p.onOpenArtifact).not.toHaveBeenCalled();
  expect(p.onArtifactCreated).toHaveBeenCalledWith(result);
  fireEvent.click(open); expect(p.onOpenArtifact).toHaveBeenCalledWith("copy");
});

it("recovers the frozen request after a lost ACK and remount even with new admission closed", async () => {
  const p = props(); ports.api.mockRejectedValueOnce(new Error("network"));
  const view = render(<NativeOfficeConversion {...p} />);
  fireEvent.click(screen.getByRole("button", { name: "Create advanced editing copy" }));
  await screen.findByRole("alert"); const body = ports.api.mock.calls[0][1].body;
  view.unmount(); const next = props(); next.enabled = false; render(<NativeOfficeConversion {...next} />);
  fireEvent.click(await screen.findByRole("button", { name: "Recover conversion" }));
  await screen.findByRole("button", { name: "Open copy" });
  expect(ports.api.mock.calls[1][1].body).toEqual(body); expect(next.editorRef.current.flush).not.toHaveBeenCalled();
  expect(ports.key).toHaveBeenCalledOnce();
});

it("never posts on local journal failure, including retries of an in-memory request", async () => {
  const p = props(); render(<NativeOfficeConversion {...p} />);
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  fireEvent.click(screen.getByRole("button", { name: "Create advanced editing copy" }));
  await screen.findByRole("alert"); expect(ports.api).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Recover conversion" }));
  await waitFor(() => expect(write).toHaveBeenCalledTimes(2)); expect(ports.api).not.toHaveBeenCalled();
  write.mockRestore(); fireEvent.click(screen.getByRole("button", { name: "Recover conversion" }));
  await screen.findByRole("button", { name: "Open copy" }); expect(ports.api).toHaveBeenCalledOnce(); expect(ports.key).toHaveBeenCalledOnce();
});

it("lets a corrected source create a new request after a definite rejection and ignores late UI callbacks", async () => {
  const p = props(); ports.api.mockRejectedValueOnce(Object.assign(new Error("NATIVE_DOCUMENT_LOCKED_CONTENT"), { status: 422 }));
  const view = render(<NativeOfficeConversion {...p} />);
  fireEvent.click(screen.getByRole("button", { name: "Create advanced editing copy" }));
  await screen.findByRole("alert"); expect(sessionStorage.getItem(journalKey)).toBeNull();
  let finish; ports.api.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole("button", { name: "Create advanced editing copy" }));
  await waitFor(() => expect(ports.api).toHaveBeenCalledTimes(2)); view.unmount();
  await act(async () => finish(result));
  expect(p.onArtifactCreated).not.toHaveBeenCalled(); expect(JSON.parse(sessionStorage.getItem(journalKey)).result).toEqual(result);
});

it("reconnects after Activity hides an in-flight conversion without keeping a stale busy flag", async () => {
  const p = props(); let first, second;
  ports.api.mockImplementationOnce(() => new Promise(resolve => { first = resolve; })).mockImplementationOnce(() => new Promise(resolve => { second = resolve; }));
  const view = render(<Activity mode="visible"><NativeOfficeConversion {...p} /></Activity>);
  fireEvent.click(screen.getByRole("button", { name: "Create advanced editing copy" }));
  await waitFor(() => expect(ports.api).toHaveBeenCalledOnce());
  view.rerender(<Activity mode="hidden"><NativeOfficeConversion {...p} /></Activity>);
  view.rerender(<Activity mode="visible"><NativeOfficeConversion {...p} /></Activity>);
  const recover = await screen.findByRole("button", { name: "Recover conversion" }); expect(recover.disabled).toBe(false);
  fireEvent.click(recover); await waitFor(() => expect(ports.api).toHaveBeenCalledTimes(2));
  await act(async () => first(result));
  expect(screen.getByRole("button", { name: "Converting…" }).disabled).toBe(true); expect(p.onArtifactCreated).not.toHaveBeenCalled();
  await act(async () => second(result));
  expect(await screen.findByRole("button", { name: "Open copy" })).toBeTruthy(); expect(p.onArtifactCreated).toHaveBeenCalledOnce();
});
