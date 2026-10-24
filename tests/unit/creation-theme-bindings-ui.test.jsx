// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import ObjectStyles from "../../src/components/creation/editors/layout/ObjectStyles";
import { layoutDocumentSchema } from "../../src/lib/creation/contracts/layout.js";
import { applyLayoutOperations } from "../../src/lib/creation/layout-operations.js";
import { applyWithInverse } from "../../src/lib/creation/layout-history.js";
import { createThemeOperation } from "../../src/lib/creation/layout-theme.js";

afterEach(cleanup);
const initial = () => layoutDocumentSchema.parse({ schemaVersion: 1, kind: "poster", title: "Brand", theme: { name: "Brand", primary: "#112233", accent: "#cc8844", background: "#ffffff", fontFamily: "sans" }, pages: [{ id: "p", title: "Poster", width: 1080, height: 1440, nodes: [{ id: "n", name: "Title", type: "text", x: 0, y: 0, width: 600, height: 100, text: "Coffee", style: { fill: "#112233", fillRole: "primary", fontRole: "theme" } }] }] });
function Inspector({ disabled = false }) {
  const [content, setContent] = useState(initial), [undo, setUndo] = useState([]);
  const change = operations => { const next = applyWithInverse(content, operations); setContent(next.document); setUndo(next.inverse); };
  return <><ObjectStyles node={content.pages[0].nodes[0]} pageId="p" apply={change} disabled={disabled} zh={false} />
    <button onClick={() => change([createThemeOperation(content, { ...content.theme, primary: "#334455", accent: "#aa5500", fontFamily: "serif" })])}>Change theme</button>
    <button onClick={() => setContent(applyLayoutOperations(content, undo))}>Undo</button>
    <output data-testid="color">{content.pages[0].nodes[0].style.fill}</output>
  </>;
}
it("binds color in the inspector, follows a theme, and detaches explicit color edits with reversible state", () => {
  render(<Inspector />);
  fireEvent.change(screen.getByLabelText("Text color source"), { target: { value: "accent" } });
  expect(screen.getByTestId("color").textContent).toBe("#cc8844");
  fireEvent.click(screen.getByText("Change theme"));
  expect(screen.getByTestId("color").textContent).toBe("#aa5500");
  fireEvent.change(screen.getByLabelText("Text color"), { target: { value: "#334455" } });
  expect(screen.getByLabelText("Text color source").value).toBe("custom");
  fireEvent.click(screen.getByText("Undo"));
  expect(screen.getByLabelText("Text color source").value).toBe("accent");
  expect(screen.getByTestId("color").textContent).toBe("#aa5500");
  fireEvent.change(screen.getByLabelText("Font"), { target: { value: "mono" } });
  expect(screen.getByLabelText("Font source").value).toBe("custom");
  fireEvent.change(screen.getByLabelText("Font source"), { target: { value: "theme" } });
  expect(screen.getByLabelText("Font").value).toBe("serif");
});
it("disables theme bindings when editing is locked or unavailable", () => {
  render(<Inspector disabled />);
  expect(screen.getByLabelText("Text color source").disabled).toBe(true);
  expect(screen.getByLabelText("Font source").disabled).toBe(true);
});
