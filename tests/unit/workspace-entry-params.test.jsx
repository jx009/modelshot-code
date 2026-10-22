// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import StudioPage from "../../src/components/studio/StudioPage.jsx";
import CommercePage from "../../src/components/discover/CommercePage.jsx";

const mocks = vi.hoisted(() => ({ query: "", studio: vi.fn(), commerce: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(mocks.query) }));
vi.mock("../../src/components/studio/StudioWorkbench", () => ({ default: props => { mocks.studio(props); return null; } }));
vi.mock("@/components/commerce/CommerceStudio", () => ({ default: props => { mocks.commerce(props); return null; } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

test("canvas captures entry parameters but does not reload initial state on its own history writes", () => {
  mocks.query = "document=one&mode=quick&count=3&prompt=hello&provider=model-a";
  const view = render(<StudioPage />);
  expect(mocks.studio).toHaveBeenLastCalledWith(expect.objectContaining({ initialDocument: "one", initialMode: "quick", initialCount: 3, initialPrompt: "hello", initialProvider: "model-a" }));
  mocks.query = "document=two";
  view.rerender(<StudioPage />);
  expect(mocks.studio).toHaveBeenLastCalledWith(expect.objectContaining({ initialDocument: "one" }));
  view.unmount();
  render(<StudioPage />);
  expect(mocks.studio).toHaveBeenLastCalledWith(expect.objectContaining({ initialDocument: "two", initialCount: 1 }));
});

test("commerce forwards project and draft parameters and applies input bounds", () => {
  mocks.query = `document=one&case=poster&draft=upload-token&brief=${"a".repeat(2500)}`;
  render(<CommercePage />);
  expect(mocks.commerce).toHaveBeenLastCalledWith({ documentId: "one", caseId: "poster", homeDraft: "upload-token", description: "a".repeat(2400) });
});
