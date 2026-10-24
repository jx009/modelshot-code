// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { registerNavigationGuard } from "../../src/lib/navigation-guard.js";
import { afterEach, expect, test, vi } from "vitest";
import { useNavigationRouter } from "../../src/hooks/useNavigationRouter.js";
import NavigationFeedback from "../../src/components/ui/NavigationFeedback.jsx";
import NavigationContent from "../../src/components/ui/NavigationContent.jsx";
import { LocalNavigationContext } from "../../src/components/ui/LocalNavigation.jsx";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn() }));
vi.mock("next-intl", () => ({ useLocale: () => "zh" }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => router }));
afterEach(() => { cleanup(); vi.resetAllMocks(); window.history.replaceState({}, "", "/"); });

function Entry({ method = "push" }) {
  const navigation = useNavigationRouter();
  return <button onClick={() => navigation[method]("/studio-v2?mode=chat")}>打开画布</button>;
}

test.each(["push", "replace"])("switches programmatic %s navigation to a destination skeleton immediately", method => {
  render(<NavigationFeedback><Entry method={method} /><NavigationContent section="creative"><p>旧页面</p></NavigationContent></NavigationFeedback>);
  fireEvent.click(screen.getByRole("button", { name: "打开画布" }));
  expect(router[method]).toHaveBeenCalledWith("/studio-v2?mode=chat", undefined);
  expect(window.location.pathname).toBe("/");
  expect(screen.getByRole("heading", { name: "自由画布" })).toBeTruthy();
  expect(screen.getByText("旧页面").closest(".navigation-current").hidden).toBe(true);
});

test.each(["push", "replace"])("uses local modules for programmatic %s without starting an RSC transition", method => {
  const visit = vi.fn(() => true);
  render(<LocalNavigationContext.Provider value={{ visit }}><NavigationFeedback><Entry method={method} /><NavigationContent section="creative"><p>旧页面</p></NavigationContent></NavigationFeedback></LocalNavigationContext.Provider>);
  fireEvent.click(screen.getByRole("button", { name: "打开画布" }));
  expect(visit).toHaveBeenCalledWith("/studio-v2?mode=chat", { replace: method === "replace" });
  expect(router[method]).not.toHaveBeenCalled();
  expect(screen.queryByRole("heading", { name: "自由画布" })).toBeNull();
});

test("waits for the workspace save before calling local visit or hiding its content", async () => {
  let release; const save = vi.fn(() => new Promise(resolve => { release = resolve; }));
  const remove = registerNavigationGuard({ prepare: save }), visit = vi.fn(() => true);
  try {
    render(<LocalNavigationContext.Provider value={{ visit }}><NavigationFeedback><Entry /><NavigationContent section="creative"><p>旧页面</p></NavigationContent></NavigationFeedback></LocalNavigationContext.Provider>);
    fireEvent.click(screen.getByText("打开画布")); fireEvent.click(screen.getByText("打开画布"));
    expect(save).toHaveBeenCalledOnce(); expect(visit).not.toHaveBeenCalled(); expect(router.push).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "自由画布" })).toBeNull();
    await act(async () => release()); expect(visit).toHaveBeenCalledOnce();
  } finally { remove(); }
});

test.each(["back", "forward"])("waits for saves before programmatic history %s", async method => {
  let release; const remove = registerNavigationGuard({ prepare: () => new Promise(resolve => { release = resolve; }) });
  try {
    render(<Entry method={method} />); fireEvent.click(screen.getByText("打开画布"));
    expect(router[method]).not.toHaveBeenCalled();
    await act(async () => release()); expect(router[method]).toHaveBeenCalledExactlyOnceWith();
  } finally { remove(); }
});
