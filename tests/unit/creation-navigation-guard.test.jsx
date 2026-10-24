// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useCreationNavigationGuard } from "../../src/components/creation/useCreationNavigationGuard.js";
import { deferNavigation } from "../../src/lib/navigation-guard.js";

afterEach(cleanup);
const deferred = () => { let reject, resolve; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function Editor({ prepare, onError }) {
  const root = useRef(null), gate = useRef(false);
  const leaving = useCreationNavigationGuard({ root, gate, prepare, onError });
  return <><section ref={root} aria-label="Workspace"><input aria-label="Cell" defaultValue="4200" /><span>{leaving ? "Saving" : "Editing"}</span></section><button>Outside</button></>;
}

it.each([false, true])("restores a blurred input after failure without stealing outside focus (outside=%s)", async outside => {
  const save = deferred(), onError = vi.fn(), proceed = vi.fn();
  render(<Editor prepare={() => save.promise} onError={onError} />);
  const input = screen.getByRole("textbox", { name: "Cell" }), root = screen.getByRole("region");
  input.focus(); input.setSelectionRange(1, 3);
  act(() => { expect(deferNavigation(proceed)).toBe(true); });
  expect(root.inert).toBe(true); expect(screen.getByText("Saving")).toBeTruthy();
  // jsdom does not implement inert's native focus change.
  input.blur();
  const button = screen.getByRole("button", { name: "Outside" });
  if (outside) button.focus();
  await act(async () => save.reject(new Error("save refused")));
  expect(proceed).not.toHaveBeenCalled(); expect(onError).toHaveBeenCalledOnce();
  expect(root.inert).toBe(false); expect(screen.getByText("Editing")).toBeTruthy();
  expect(document.activeElement).toBe(outside ? button : input);
  expect(input.selectionStart).toBe(1); expect(input.selectionEnd).toBe(3);
});

it("does not restore a detached editor's focus when it unmounts during save", async () => {
  const save = deferred(), proceed = vi.fn(), onError = vi.fn();
  const view = render(<Editor prepare={() => save.promise} onError={onError} />);
  const input = screen.getByRole("textbox"); input.focus();
  act(() => deferNavigation(proceed));
  view.unmount();
  const focus = vi.spyOn(input, "focus");
  await act(async () => save.resolve());
  expect(proceed).not.toHaveBeenCalled(); expect(focus).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled();
});
