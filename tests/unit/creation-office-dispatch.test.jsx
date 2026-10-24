// @vitest-environment jsdom
import { createRef } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import OfficeArtifactEditor from "../../src/components/creation/OfficeArtifactEditor";

const ports = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("../../src/lib/client-api", () => ({ api: (...args) => ports.api(...args) }));
vi.mock("../../src/components/creation/NativeOfficeArtifactEditor", () => ({ default: () => <div>Native editor</div> }));
vi.mock("../../src/components/creation/DocumentArtifactEditor", () => ({ default: () => <div>Legacy document</div> }));
vi.mock("../../src/components/creation/SheetArtifactEditor", () => ({ default: () => <div>Legacy sheet</div> }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("resolves the owned format before loading a native or legacy editor", async () => {
  for (const [kind, schemaVersion, label] of [["document", 1, "Legacy document"], ["sheet", 1, "Legacy sheet"], ["document", 2, "Native editor"], ["sheet", 2, "Native editor"]]) {
    ports.api.mockResolvedValueOnce({ id: "a", kind, schemaVersion });
    render(<OfficeArtifactEditor userId="u" artifactId="a" kind={kind} zh={false} editorRef={createRef()} />);
    expect(await screen.findByText(label)).toBeTruthy(); cleanup();
  }
  expect(ports.api.mock.calls.every(([path]) => path === "/api/creation/artifacts/a/format")).toBe(true);
});

it("blocks navigation while resolving format and ignores a stale response after switching files", async () => {
  let resolve;
  ports.api.mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockResolvedValueOnce({ id: "b", kind: "sheet", schemaVersion: 1 });
  const ref = createRef(), view = render(<OfficeArtifactEditor userId="u" artifactId="a" kind="sheet" zh={false} editorRef={ref} />);
  await expect(ref.current.flush()).rejects.toThrow("ARTIFACT_NOT_READY");
  view.rerender(<OfficeArtifactEditor userId="u" artifactId="b" kind="sheet" zh={false} editorRef={ref} />);
  await screen.findByText("Legacy sheet");
  await act(async () => resolve({ id: "a", kind: "sheet", schemaVersion: 2 }));
  expect(screen.queryByText("Native editor")).toBeNull(); expect(ports.api.mock.calls[0][1].signal.aborted).toBe(true);
});

it("rejects a mismatched kind or unknown schema instead of falling back to a lossy editor", async () => {
  ports.api.mockResolvedValueOnce({ id: "a", kind: "sheet", schemaVersion: 3 });
  render(<OfficeArtifactEditor userId="u" artifactId="a" kind="sheet" zh={false} editorRef={createRef()} />);
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByText("Legacy sheet")).toBeNull(); expect(screen.queryByText("Native editor")).toBeNull();
});
