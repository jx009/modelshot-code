// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import OutlineReview from "../../src/components/creation/OutlineReview";
vi.mock("../../src/components/creation/DraftSessionGate", () => ({ default: ({ children }) => children("test-session-123456", () => {}) }));

const mocks = vi.hoisted(() => ({ api: vi.fn(), read: vi.fn(), write: vi.fn() }));
vi.mock("@/lib/client-api", () => ({ api: mocks.api, requestKey: () => "test-outline-confirmation-key" }));
vi.mock("@/lib/creation/client/drafts", () => ({ readArtifactDraft: mocks.read, writeArtifactDraft: mocks.write }));
const outline = () => ({ title: "Coffee", theme: { name: "Simple", primary: "#000000", accent: "#ff0000", background: "#ffffff", fontFamily: "sans" }, pages: [{ id: "a", title: "Overview", brief: "Introduce the store", notes: "Opening notes" }, { id: "b", title: "Offer", brief: "Describe the offer", notes: "" }] });
const review = () => ({ outline: outline(), expectedSequence: 7, unitCost: 2, committedCredits: 2, maxCredits: 6, canConfirm: true, confirmed: false });
beforeEach(() => { mocks.api.mockReset(); mocks.read.mockReset(); mocks.write.mockReset(); mocks.read.mockResolvedValue(null); mocks.write.mockResolvedValue(undefined); });
afterEach(cleanup);

it("quotes illustrations visibly and omits the paid image request when unchecked", async () => {
  const remote = review(); remote.kind = "slides";
  remote.outline.design = { audience: "Teams", narrative: "Launch", artDirection: "Editorial", typography: "Large type", spacing: "64px", visuals: [{ id: "hero", prompt: "Workspace" }] };
  remote.outline.pages[0].visualId = "hero";
  remote.image = { size: "1536x1024", provider: "images", expectedCost: 4 };
  mocks.api.mockResolvedValueOnce(remote).mockResolvedValueOnce({ id: "run", status: "queued" });
  const confirmed = vi.fn();
  render(<OutlineReview userId="owner" runId="run" zh={false} onClose={() => {}} onConfirmed={confirmed} />);
  const checkbox = await screen.findByLabelText("Generate original illustrations");
  expect(checkbox.checked).toBe(true);
  expect(screen.getByText(/Estimated total: 10 credits/)).toBeTruthy();
  fireEvent.click(checkbox);
  expect(screen.getByText(/Estimated total: 6 credits/)).toBeTruthy();
  fireEvent.click(screen.getByText("Confirm and generate slides"));
  await waitFor(() => expect(confirmed).toHaveBeenCalledOnce());
  expect(mocks.api.mock.calls.find(([, options]) => options?.method === "POST")[1].body.image).toBeUndefined();
});

it("persists the edited outline through its navigation handle without confirming or charging", async () => {
  mocks.api.mockResolvedValue(review()); const editorRef = createRef();
  render(<OutlineReview editorRef={editorRef} userId="owner" runId="run" zh={false} onClose={() => {}} onConfirmed={vi.fn()} />);
  await screen.findByDisplayValue("Overview");
  fireEvent.change(screen.getByLabelText("Slide title"), { target: { value: "Before leaving" } });
  await act(async () => { await editorRef.current.flush(); });
  expect(mocks.write.mock.calls.at(-1)[2].value.pages[0].title).toBe("Before leaving");
  expect(mocks.api.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(0);
  mocks.write.mockRejectedValueOnce(new Error("LOCAL_DRAFT_UNAVAILABLE"));
  await act(async () => { await expect(editorRef.current.flush()).rejects.toThrow("LOCAL_DRAFT_UNAVAILABLE"); });
});

it("recalculates illustration totals and confirms the selected model", async () => {
  const remote = review(); remote.kind = "slides";
  remote.outline.design = { visuals: [{ id: "hero", prompt: "Workspace" }] };
  remote.outline.pages[0].visualId = "hero";
  remote.image = { size: "1536x1024", provider: "default", expectedCost: 4 };
  remote.imageModels = [{ id: "custom", label: "Custom images", image: { provider: "custom", size: "1536x1024", expectedCost: 9 } }];
  mocks.api.mockResolvedValueOnce(remote).mockResolvedValueOnce({ id: "run", status: "queued" });
  render(<OutlineReview userId="owner" runId="run" zh={false} onClose={() => {}} onConfirmed={vi.fn()} />);
  fireEvent.change(await screen.findByLabelText("Image model"), { target: { value: "custom" } });
  expect(screen.getByText(/Estimated total: 15 credits/)).toBeTruthy();
  expect(screen.getByText("Confirm and generate slides").disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Total budget limit"), { target: { value: "15" } });
  fireEvent.click(screen.getByText("Confirm and generate slides"));
  await waitFor(() => expect(mocks.api.mock.calls.some(([, options]) => options?.method === "POST")).toBe(true));
  expect(mocks.api.mock.calls.find(([, options]) => options?.method === "POST")[1].body.image).toEqual(remote.imageModels[0].image);
});

it("does not submit on open, allows reordering/removal, and confirms exactly the reviewed content", async () => {
  const confirmed = vi.fn();
  mocks.api.mockResolvedValueOnce(review()).mockResolvedValueOnce({ id: "run", status: "queued" });
  render(<OutlineReview userId="owner" runId="run" zh={false} onClose={() => {}} onConfirmed={confirmed} />);
  await screen.findByDisplayValue("Overview");
  expect(mocks.api).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText("Slide title"), { target: { value: "Approved headline" } });
  fireEvent.change(screen.getByLabelText("Speaker notes"), { target: { value: "Exact approved notes" } });
  fireEvent.click(screen.getByLabelText("Move slide down"));
  expect(screen.getByLabelText("Slide title").value).toBe("Approved headline");
  fireEvent.click(screen.getByText("Confirm and generate slides"));
  await waitFor(() => expect(confirmed).toHaveBeenCalledOnce());
  const request = mocks.api.mock.calls.find(([, options]) => options?.method === "POST")[1].body;
  expect(request.outline.pages.map(page => page.id)).toEqual(["b", "a"]);
  expect(request.outline.pages[1]).toMatchObject({ title: "Approved headline", notes: "Exact approved notes" });
  expect(request).toMatchObject({ expectedSequence: 7, expectedUnitCost: 2, maxCredits: 6 });
  expect(mocks.write.mock.calls.some(([, , draft]) => draft.inflight?.saveKey === request.saveKey && draft.dirty)).toBe(true);
  expect(mocks.write.mock.calls.at(-1)[2].inflight).toBeNull();
});

it("keeps an uncertain confirmation frozen and replays the same key even when GET reports it accepted", async () => {
  const body = { saveKey: "previous-confirmation-key", expectedSequence: 7, expectedUnitCost: 2, maxCredits: 6, outline: outline() };
  mocks.read.mockResolvedValue({ format: "outline-v1", value: body.outline, budget: 6, dirty: true, inflight: body });
  mocks.api.mockResolvedValueOnce({ ...review(), expectedSequence: 8, canConfirm: false, confirmed: true }).mockResolvedValueOnce({ id: "run" });
  const confirmed = vi.fn();
  render(<OutlineReview userId="owner" runId="run" zh={false} onClose={() => {}} onConfirmed={confirmed} />);
  await screen.findByText("Recover confirmation");
  expect(screen.getByLabelText("Slide title").disabled).toBe(true);
  fireEvent.click(screen.getByText("Recover confirmation"));
  await waitFor(() => expect(confirmed).toHaveBeenCalledOnce());
  expect(mocks.api.mock.calls[1][1].body).toEqual(body);
});

it("blocks confirmation until added-page content and its additional budget are provided", async () => {
  mocks.api.mockResolvedValue(review());
  render(<OutlineReview userId="owner" runId="run" zh={false} onClose={() => {}} onConfirmed={() => {}} />);
  await screen.findByDisplayValue("Overview");
  fireEvent.click(screen.getByText("Add slide"));
  expect(screen.getByText("Confirm and generate slides").disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Content and layout brief"), { target: { value: "New page content" } });
  expect(screen.getByText("Confirm and generate slides").disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Total budget limit"), { target: { value: "8" } });
  expect(screen.getByText("Confirm and generate slides").disabled).toBe(false);
  expect(mocks.api).toHaveBeenCalledTimes(1);
});

it("reviews document sections without slide notes and confirms the edited order and writing brief", async () => {
  const value = { title: "Report", sections: [{ id: "a", title: "Summary", brief: "Overview" }, { id: "b", title: "Findings", brief: "Explain findings" }] };
  mocks.api.mockResolvedValueOnce({ ...review(), kind: "document", outline: value }).mockResolvedValueOnce({ id: "run", status: "queued" });
  const confirmed = vi.fn();
  render(<OutlineReview userId="owner" runId="run" zh={false} onClose={() => {}} onConfirmed={confirmed} />);
  await screen.findByLabelText("Section title");
  expect(screen.queryByLabelText("Speaker notes")).toBeNull();
  expect(screen.getByRole("button", { name: /Summary/ })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Content and writing brief"), { target: { value: "Approved exact facts" } });
  fireEvent.click(screen.getByLabelText("Move section down"));
  fireEvent.click(screen.getByText("Confirm and generate document"));
  await waitFor(() => expect(confirmed).toHaveBeenCalledOnce());
  const body = mocks.api.mock.calls.find(([, options]) => options?.method === "POST")[1].body;
  expect(body.outline.sections.map(section => section.id)).toEqual(["b", "a"]);
  expect(body.outline.sections[1].brief).toBe("Approved exact facts");
  expect(body.outline.pages).toBeUndefined();
});

it("recovers the exact pending document confirmation after the server has already accepted it", async () => {
  const value = { title: "Report", sections: [{ id: "a", title: "Summary", brief: "Facts" }] };
  const body = { saveKey: "previous-document-confirmation", expectedSequence: 7, expectedUnitCost: 2, maxCredits: 4, outline: value };
  mocks.read.mockResolvedValue({ format: "outline-v1", value, budget: 4, dirty: true, inflight: body });
  mocks.api.mockResolvedValueOnce({ ...review(), kind: "document", outline: value, confirmed: true, canConfirm: false }).mockResolvedValueOnce({ id: "run" });
  const confirmed = vi.fn();
  render(<OutlineReview userId="owner" runId="run" zh={false} onClose={() => {}} onConfirmed={confirmed} />);
  fireEvent.click(await screen.findByText("Recover confirmation"));
  await waitFor(() => expect(confirmed).toHaveBeenCalledOnce());
  expect(mocks.api.mock.calls[1][1].body).toEqual(body);
});

it("reviews and persists document-wide writing direction without changing its page settings", async () => {
  const design = { purpose: "Decision", tone: "Concise", narrative: "Evidence first", terminology: "USD", page: { size: "A4", orientation: "portrait", marginLeft: 54 }, theme: { fontSize: 11 } };
  const value = { title: "Report", design, sections: [{ id: "a", title: "Summary", brief: "Facts" }] };
  mocks.api.mockResolvedValueOnce({ ...review(), kind: "document", outline: value }).mockResolvedValueOnce({ id: "run" });
  const confirmed = vi.fn();
  render(<OutlineReview userId="owner" runId="run" zh={false} onClose={() => {}} onConfirmed={confirmed} />);
  fireEvent.click(await screen.findByText("Document writing and layout plan"));
  fireEvent.change(screen.getByLabelText("Tone"), { target: { value: "Clear and direct" } });
  fireEvent.click(screen.getByText("Confirm and generate document"));
  await waitFor(() => expect(confirmed).toHaveBeenCalledOnce());
  const body = mocks.api.mock.calls.find(([, options]) => options?.method === "POST")[1].body;
  expect(body.outline.design).toEqual({ ...design, tone: "Clear and direct" });
  expect(body.image).toBeUndefined();
});
