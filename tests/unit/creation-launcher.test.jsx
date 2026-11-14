// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import CreationLauncher from "../../src/components/discover/CreationLauncher";

const mocks = vi.hoisted(() => ({ api: vi.fn(), push: vi.fn(), key: 0 }));
vi.mock("../../src/lib/client-api", () => ({ api: (...args) => mocks.api(...args), requestKey: () => `request-key-${String(++mocks.key).padStart(8, "0")}` }));
vi.mock("../../src/hooks/useNavigationRouter", () => ({ useNavigationRouter: () => ({ push: mocks.push }) }));
vi.mock("../../src/lib/studio/project-list", () => ({ invalidateProjectLists: vi.fn() }));
vi.mock("../../src/components/creation/ReferenceAssets", () => ({ default: () => null, referenceAssetIds: value => value || [] }));

beforeEach(() => {
  sessionStorage.clear(); mocks.key = 0; mocks.push.mockReset(); mocks.api.mockReset().mockImplementation(async (url, options) => {
    if (url === "/api/creation/capabilities") return { poster: true, slides: true, document: true, sheet: true, web: true, languageUnitCost: 2 };
    if (url === "/api/creation/projects") return { id: "project_1", sessions: [{ id: "session_1" }] };
    if (url.startsWith("/api/creation/sessions/")) return { id: "run_1" };
    throw new Error(`Unexpected API request: ${url} ${options?.method || "GET"}`);
  });
});
afterEach(cleanup);

async function submit(kind, prompt, configure) {
  render(<CreationLauncher kind={kind} userId="user_1" zh={false} />);
  fireEvent.change(await screen.findByLabelText("Creation request"), { target: { value: prompt } });
  fireEvent.click(screen.getByText("Settings"));
  configure?.();
  fireEvent.submit(screen.getByRole("button", { name: "Start creating" }).closest("form"));
  await waitFor(() => expect(mocks.api).toHaveBeenCalledWith(expect.stringContaining("/messages"), expect.objectContaining({ method: "POST" })));
  return mocks.api.mock.calls.find(([url, options]) => url.includes("/messages") && options?.method === "POST")[1].body;
}

it("keeps poster dimensions and a single page in the launch request", async () => {
  const body = await submit("poster", "A seasonal coffee poster", () => fireEvent.change(screen.getByLabelText("Size"), { target: { value: "1080x1080" } }));
  expect(body).toEqual({ kind: "poster", prompt: "A seasonal coffee poster", locale: "en", maxCredits: 2, assetIds: [], width: 1080, height: 1080, pageCount: 1 });
});

it("includes explicitly quoted AI artwork in the poster budget and request", async () => {
  render(<CreationLauncher kind="poster" userId="user_1" zh={false} initialCaps={{ poster: true, languageUnitCost: 2, posterImage: { provider: "image-channel", prices: { "1024x1536": 4 } } }} />);
  fireEvent.change(screen.getByLabelText("Creation request"), { target: { value: "Coffee opening" } });
  fireEvent.click(screen.getByText("Settings"));
  expect(screen.getByRole("checkbox", { name: "AI artwork · 4 credits" }).checked).toBe(true);
  fireEvent.submit(screen.getByRole("button", { name: "Start creating" }).closest("form"));
  await waitFor(() => expect(mocks.push).toHaveBeenCalled());
  expect(mocks.api.mock.calls.find(([url]) => url.includes("/messages"))[1].body).toMatchObject({ maxCredits: 6, image: { size: "1024x1536", expectedCost: 4, provider: "image-channel" } });
});

it("can use typography and existing artwork without generating a paid image", async () => {
  render(<CreationLauncher kind="poster" userId="user_1" zh={false} initialCaps={{ poster: true, languageUnitCost: 2, posterImage: { prices: { "1024x1536": 4 } } }} />);
  fireEvent.change(screen.getByLabelText("Creation request"), { target: { value: "Typography only" } });
  fireEvent.click(screen.getByText("Settings"));
  fireEvent.click(screen.getByRole("checkbox", { name: "AI artwork · 4 credits" }));
  fireEvent.submit(screen.getByRole("button", { name: "Start creating" }).closest("form"));
  await waitFor(() => expect(mocks.push).toHaveBeenCalled());
  const body = mocks.api.mock.calls.find(([url]) => url.includes("/messages"))[1].body;
  expect(body.maxCredits).toBe(2); expect(body.image).toBeUndefined();
});

it("quotes and submits the chosen poster image model rather than the default", async () => {
  render(<CreationLauncher kind="poster" userId="user_1" zh={false} initialCaps={{ poster: true, languageUnitCost: 2, posterImage: { provider: "default", prices: { "1024x1536": 4 } }, imageModels: [{ id: "custom", provider: "custom", label: "Custom images", prices: { "1024x1536": 9 } }] }} />);
  fireEvent.change(screen.getByLabelText("Creation request"), { target: { value: "Coffee opening" } });
  fireEvent.click(screen.getByText("Settings"));
  fireEvent.change(screen.getByLabelText("Image model"), { target: { value: "custom" } });
  expect(screen.getByRole("checkbox", { name: "AI artwork · 9 credits" }).checked).toBe(true);
  fireEvent.submit(screen.getByRole("button", { name: "Start creating" }).closest("form"));
  await waitFor(() => expect(mocks.push).toHaveBeenCalled());
  expect(mocks.api.mock.calls.find(([url]) => url.includes("/messages"))[1].body).toMatchObject({ maxCredits: 11, image: { provider: "custom", size: "1024x1536", expectedCost: 9 } });
});

it("carries the slide image model to outline review without charging for unapproved visuals", async () => {
  render(<CreationLauncher kind="slides" userId="user_1" zh={false} initialCaps={{ slides: true, languageUnitCost: 2, imageModels: [{ id: "custom", provider: "custom", label: "Custom images", prices: { "1536x1024": 9 } }] }} />);
  fireEvent.change(screen.getByLabelText("Creation request"), { target: { value: "Pitch deck" } });
  fireEvent.click(screen.getByText("Settings"));
  fireEvent.change(screen.getByLabelText("Image model"), { target: { value: "custom" } });
  fireEvent.submit(screen.getByRole("button", { name: "Start creating" }).closest("form"));
  await waitFor(() => expect(mocks.push).toHaveBeenCalled());
  const body = mocks.api.mock.calls.find(([url]) => url.includes("/messages"))[1].body;
  expect(body).toMatchObject({ imageProvider: "custom", maxCredits: 22 });
  expect(body.image).toBeUndefined();
});

it("replays the exact unconfirmed artwork request even when current quotes change", async () => {
  const body = { kind: "poster", prompt: "Coffee opening", locale: "en", maxCredits: 6, assetIds: [], width: 1080, height: 1440, pageCount: 1, image: { size: "1024x1536", expectedCost: 4, provider: "old-channel" } };
  sessionStorage.setItem("creation-launch:user_1:poster", JSON.stringify({ userId: "user_1", createKey: "saved-create-key", runKey: "saved-run-key", project: { id: "project_1", sessionId: "session_1" }, body }));
  render(<CreationLauncher kind="poster" userId="user_1" zh={false} initialCaps={{ poster: true, languageUnitCost: 3, posterImage: { provider: "new-channel", prices: { "1024x1536": 9 } } }} />);
  await waitFor(() => expect(screen.getByLabelText("Creation request").disabled).toBe(true));
  fireEvent.click(screen.getByText("Settings"));
  expect(screen.getByRole("checkbox", { name: "AI artwork · 4 credits" }).disabled).toBe(true);
  expect(document.querySelector(".cr-creation-cost").textContent).toBe("6 credits");
  fireEvent.submit(screen.getByRole("button", { name: "Recover submission" }).closest("form"));
  await waitFor(() => expect(mocks.push).toHaveBeenCalled());
  expect(mocks.api.mock.calls.find(([url]) => url.includes("/messages"))[1]).toMatchObject({ key: "saved-run-key", body });
  expect(mocks.api.mock.calls.some(([url]) => url === "/api/creation/projects")).toBe(false);
});

it("prices slide generation by outline plus requested pages", async () => {
  const body = await submit("slides", "Quarterly results", () => fireEvent.change(screen.getByLabelText("Slides"), { target: { value: "8" } }));
  expect(body).toMatchObject({ kind: "slides", pageCount: 8, width: 1920, height: 1080, maxCredits: 18 });
});

it("sends document section count and budgets the outline plus sections", async () => {
  const body = await submit("document", "A launch brief", () => fireEvent.change(screen.getByLabelText("Sections"), { target: { value: "4" } }));
  expect(body).toEqual({ kind: "document", prompt: "A launch brief", locale: "en", sectionCount: 4, audience: "", maxCredits: 10, assetIds: [] });
});

it("sends sheet-specific shape without image or page fields", async () => {
  const body = await submit("sheet", "A sales forecast", () => {
    fireEvent.change(screen.getByLabelText("Sheets"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Target rows"), { target: { value: "40" } });
  });
  expect(body).toEqual({ kind: "sheet", prompt: "A sales forecast", locale: "en", sheetCount: 3, targetRows: 40, maxCredits: 2, assetIds: [] });
});

it("sends website page count without image dimensions", async () => {
  const body = await submit("web", "A coffee shop website", () => fireEvent.change(screen.getByLabelText("Pages"), { target: { value: "4" } }));
  expect(body).toEqual({ kind: "web", prompt: "A coffee shop website", locale: "en", pageCount: 4, maxCredits: 2, assetIds: [] });
});

it("reuses homepage capabilities and fetches them again only after a manual refresh", async () => {
  mocks.api.mockImplementation(async url => {
    if (url === "/api/creation/projects") throw new Error("Project creation failed");
    if (url === "/api/creation/capabilities") return { poster: true, slides: true, document: true, sheet: true, web: true, languageUnitCost: 2 };
    throw new Error(`Unexpected API request: ${url}`);
  });
  render(<CreationLauncher kind="poster" userId="user_1" zh={false} initialCaps={{ poster: true, languageUnitCost: 2 }} />);
  fireEvent.change(await screen.findByLabelText("Creation request"), { target: { value: "A seasonal coffee poster" } });
  fireEvent.submit(screen.getByRole("button", { name: "Start creating" }).closest("form"));
  fireEvent.click(await screen.findByRole("button", { name: "Refresh availability" }));
  await waitFor(() => expect(mocks.api).toHaveBeenCalledWith("/api/creation/capabilities", expect.objectContaining({ signal: expect.any(AbortSignal) })));
  expect(mocks.api.mock.calls.filter(([url]) => url === "/api/creation/capabilities")).toHaveLength(1);
});
