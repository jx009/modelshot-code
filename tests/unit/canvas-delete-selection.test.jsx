// @vitest-environment jsdom
import { useRef, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useDeleteSelection } from "../../src/components/studio/canvas/hooks/useDeleteSelection.js";

afterEach(cleanup);
const layers = [
  { id: "photo", type: "image", visible: true },
  { id: "other", type: "image", visible: true },
  { id: "locked", type: "image", visible: true, locked: true },
];
function Canvas({ hidden = false, ...props }) {
  const container = useRef(null);
  useDeleteSelection({ container, layers, selectedIds: ["photo"], ...props });
  return <div ref={container} hidden={hidden}><button>图层</button><textarea aria-label="提示词" /><div contentEditable suppressContentEditableWarning><span>编辑文字</span></div></div>;
}

it.each(["Delete", "Backspace"])("removes selected images with %s through the existing change callback", key => {
  const onChange = vi.fn(), onSelect = vi.fn();
  render(<Canvas onChange={onChange} onSelect={onSelect} />);
  expect(fireEvent.keyDown(screen.getByText("图层"), { key })).toBe(false);
  expect(onChange).toHaveBeenCalledExactlyOnceWith(layers.slice(1));
  expect(onSelect).toHaveBeenCalledExactlyOnceWith([]);
});

it("deletes a multi-selection but retains locked layers and their selection", () => {
  const onChange = vi.fn(), onSelect = vi.fn();
  render(<Canvas selectedIds={["photo", "other", "locked"]} onChange={onChange} onSelect={onSelect} />);
  fireEvent.keyDown(document.body, { key: "Delete" });
  expect(onChange).toHaveBeenCalledExactlyOnceWith([layers[2]]);
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(["locked"]);
});

it("does not delete while editing text or when a dialog is open", () => {
  const onChange = vi.fn();
  render(<Canvas onChange={onChange} onSelect={vi.fn()} />);
  fireEvent.keyDown(screen.getByLabelText("提示词"), { key: "Backspace" });
  fireEvent.keyDown(screen.getByText("编辑文字"), { key: "Delete" });
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog"); document.body.append(dialog);
  fireEvent.keyDown(document.body, { key: "Delete" });
  dialog.remove();
  expect(onChange).not.toHaveBeenCalled();
});

it.each([{ disabled: true }, { hidden: true }, { selectedIds: [] }, { selectedIds: ["locked"] }])("does not delete inactive or noneditable selections: %j", props => {
  const onChange = vi.fn();
  render(<Canvas {...props} onChange={onChange} onSelect={vi.fn()} />);
  expect(fireEvent.keyDown(document.body, { key: "Delete" })).toBe(true);
  expect(onChange).not.toHaveBeenCalled();
});

it.each([{ isComposing: true }, { keyCode: 229 }, { repeat: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }])("does not consume composition, repeated or modified key presses: %j", options => {
  const onChange = vi.fn();
  render(<Canvas onChange={onChange} onSelect={vi.fn()} />);
  expect(fireEvent.keyDown(document.body, { key: "Delete", ...options })).toBe(true);
  expect(onChange).not.toHaveBeenCalled();
});

it("uses the latest selection and removes the listener on unmount", () => {
  const onChange = vi.fn(), onSelect = vi.fn();
  const view = render(<Canvas onChange={onChange} onSelect={onSelect} />);
  view.rerender(<Canvas selectedIds={["other"]} onChange={onChange} onSelect={onSelect} />);
  fireEvent.keyDown(document.body, { key: "Delete" });
  expect(onChange).toHaveBeenCalledExactlyOnceWith([layers[0], layers[2]]);
  view.unmount();
  fireEvent.keyDown(document.body, { key: "Delete" });
  expect(onChange).toHaveBeenCalledOnce();
});

it("leaves deletion undoable by the caller's existing history mechanism", () => {
  function HistoryCanvas() {
    const [current, setCurrent] = useState(layers);
    const history = useRef([]);
    return <><Canvas layers={current} onChange={next => { history.current.push(current); setCurrent(next); }} onSelect={() => {}} /><output>{current.map(layer => layer.id).join(",")}</output><button onClick={() => setCurrent(history.current.pop())}>撤销</button></>;
  }
  render(<HistoryCanvas />);
  fireEvent.keyDown(document.body, { key: "Delete" });
  expect(screen.getByRole("status").textContent).toBe("other,locked");
  fireEvent.click(screen.getByText("撤销"));
  expect(screen.getByRole("status").textContent).toBe("photo,other,locked");
});
