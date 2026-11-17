// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import CreationStart from "../../src/components/creation/CreationStart";

const mocks = vi.hoisted(() => ({ api: vi.fn(), push: vi.fn(), key: 0 }));
vi.mock("../../src/lib/client-api", () => ({ api: (...args) => mocks.api(...args), requestKey: () => `request-key-${String(++mocks.key).padStart(8, "0")}` }));
vi.mock("../../src/hooks/useNavigationRouter", () => ({ useNavigationRouter: () => ({ push: mocks.push }) }));
vi.mock("../../src/lib/studio/project-list", () => ({ invalidateProjectLists: vi.fn() }));
vi.mock("../../src/components/creation/ReferenceAssets", () => ({ default: () => null, referenceAssetIds: value => value || [] }));
vi.mock("../../src/components/creation/CreationWorkspace", () => ({ SLIDE_IDEAS: [["季度经营复盘汇报", "Quarterly business review"]] }));

beforeEach(() => {
  sessionStorage.clear(); mocks.key = 0; mocks.push.mockReset(); mocks.api.mockReset().mockImplementation(async url => {
    if (url === "/api/creation/capabilities") return { slides: true, languageUnitCost: 3 };
    if (url === "/api/creation/projects") return { id: "project_1", sessions: [{ id: "session_1" }] };
    if (url.startsWith("/api/creation/sessions/")) return { id: "run_1" };
    throw new Error(`Unexpected API request: ${url}`);
  });
});
afterEach(cleanup);

it("opens a PPT workspace without a project and creates one only when the first request is sent", async () => {
  render(<CreationStart userId="user_1" zh={false} />);
  await waitFor(() => expect(mocks.api).toHaveBeenCalledWith("/api/creation/capabilities", expect.anything()));
  expect(mocks.api).not.toHaveBeenCalledWith("/api/creation/projects", expect.anything());
  fireEvent.click(screen.getByRole("button", { name: /Quarterly business review/ }));
  expect(screen.getByLabelText("Creation request").value).toBe("Quarterly business review");
  await waitFor(() => expect(screen.getByRole("button", { name: "Start creating" }).disabled).toBe(false));
  fireEvent.submit(screen.getByLabelText("Creation request").closest("form"));
  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/creation?project=project_1&session=session_1"));
  const message = mocks.api.mock.calls.find(([url]) => url.includes("/messages"))[1].body;
  expect(message).toMatchObject({ kind: "slides", prompt: "Quarterly business review" });
});
