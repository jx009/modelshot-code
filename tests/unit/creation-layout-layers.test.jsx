// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import LayoutEditor from "../../src/components/creation/editors/layout/LayoutEditor";
import { layoutDocumentSchema } from "../../src/lib/creation/contracts/layout.js";

vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("../../src/components/creation/editors/layout/SlideNavigator", () => ({ default: ({ pages, onSelect }) => <nav>{pages.map(page => <button key={page.id} onClick={() => onSelect(page.id)}>{page.title}</button>)}</nav> }));
afterEach(cleanup);

it("keeps collapsed layers unmounted and lets reopened layers select the current page's objects", () => {
  const content = layoutDocumentSchema.parse({ schemaVersion: 1, kind: "slides", title: "Layers", theme: { name: "Brand", primary: "#33443b", accent: "#cb985e", background: "#faf7ef", fontFamily: "sans" }, pages: [0, 1].map(index => ({
    id: `page-${index}`, title: `Page ${index}`, width: 1920, height: 1080,
    nodes: [{ id: "title", name: `Title ${index}`, type: "text", text: `Text ${index}`, x: 100, y: 100, width: 600, height: 180, style: {} }],
  })) });
  const operations = vi.fn();
  render(<LayoutEditor content={content} getContent={() => content} onOperations={operations} zh={false} />);
  expect(screen.queryByRole("complementary", { name: "Artwork properties" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Artwork properties" }));
  const details = screen.getByText(/Layers ·/).closest("details");
  expect(within(details).queryAllByRole("button", { hidden: true })).toHaveLength(0);
  details.open = true; fireEvent(details, new Event("toggle"));
  fireEvent.click(within(details).getByRole("button", { name: "Title 0" }));
  fireEvent.change(screen.getByLabelText("Text"), { target: { value: "Edited first" } });
  expect(operations).toHaveBeenLastCalledWith([{ op: "setText", pageId: "page-0", nodeId: "title", text: "Edited first" }]);
  fireEvent.click(screen.getByRole("button", { name: "Page 1", exact: true }));
  expect(within(details).queryByRole("button", { name: "Title 0" })).toBeNull();
  fireEvent.click(within(details).getByRole("button", { name: "Title 1" }));
  expect(screen.getByLabelText("Text").value).toBe("Text 1");
  details.open = false; fireEvent(details, new Event("toggle"));
  expect(within(details).queryAllByRole("button", { hidden: true })).toHaveLength(0);
  details.open = true; fireEvent(details, new Event("toggle"));
  expect(within(details).getByRole("button", { name: "Title 1" }).className).toBe("is-selected");
});
