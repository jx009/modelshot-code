import { expect, it } from "vitest";
import { nextSlideStep, slideRunProgress, slideInsertionIndex } from "../../src/lib/creation/slide-scheduling.js";

const outline = { id: "outline", tool: "slides.outline", status: "succeeded", dependsOn: [] };
const page = (id, status = "ready", jobId) => ({ id, tool: "slides.page", status, jobId, dependsOn: ["outline"] });
const run = steps => ({ kind: "slides", steps: [outline, ...steps] });

it("fills a second page slot but never submits a third while two are active", () => {
  const first = page("first", "running", "job1"), second = page("second"), third = page("third");
  expect(nextSlideStep(run([first, second, third]), [{ id: "job1", status: "running" }])).toBe(second);
  const queued = { ...second, status: "queued", jobId: "job2" };
  expect(nextSlideStep(run([first, queued, third]), [{ id: "job1", status: "running" }, { id: "job2", status: "queued" }])).toBe(first);
});

it("publishes a later finished page before waiting for an earlier slow one", () => {
  const first = page("first", "running", "job1"), second = page("second", "queued", "job2");
  for (const status of ["succeeded", "failed", "cancelled"]) {
    expect(nextSlideStep(run([first, second, page("third")]), [{ id: "job1", status: "running" }, { id: "job2", status }])).toBe(second);
  }
  expect(nextSlideStep(run([first, second]), [{ id: "job1", status: "running" }])).toBe(second);
});

it("never starts ready pages during cancellation", () => {
  const active = page("active", "running", "job");
  expect(nextSlideStep({ ...run([page("ready"), active]), cancelRequestedAt: new Date() }, [{ id: "job", status: "running" }])).toBe(active);
  expect(nextSlideStep({ ...run([page("ready")]), cancelRequestedAt: new Date() }, [])).toBeNull();
});

it("drains independent pages after a failure and releases assembly only after all pages succeed", () => {
  const first = { ...page("first", "failed", "job1"), errorCode: "LANGUAGE_TIMEOUT" };
  const second = page("second", "running", "job2");
  const assembly = { id: "assembly", tool: "layout.assemble", status: "blocked", dependsOn: ["first", "second"] };
  expect(slideRunProgress(run([first, second, assembly]).steps)).toMatchObject({ status: "running", released: [], errorCode: null });
  expect(slideRunProgress(run([first, { ...second, status: "succeeded" }, assembly]).steps)).toMatchObject({ status: "failed", released: [], errorCode: "LANGUAGE_TIMEOUT" });
  expect(slideRunProgress(run([{ ...first, status: "succeeded" }, { ...second, status: "succeeded" }, assembly]).steps)).toMatchObject({ status: "running", released: [assembly], ready: { id: "assembly" } });
  expect(slideRunProgress(run([{ ...first, status: "succeeded" }, { ...second, status: "succeeded" }, { ...assembly, status: "succeeded" }]).steps).status).toBe("succeeded");
});

it("inserts out-of-order results in approved order and retains existing edited page objects", () => {
  const approved = { pages: ["a", "b", "c", "d"].map(id => ({ id })) };
  const edited = { id: "c", html: "User-edited page" }, pages = [edited];
  for (const id of ["a", "d", "b"]) pages.splice(slideInsertionIndex(pages, approved, id), 0, { id });
  expect(pages.map(page => page.id)).toEqual(["a", "b", "c", "d"]);
  expect(pages[2]).toBe(edited);
});
