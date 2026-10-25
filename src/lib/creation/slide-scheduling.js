import { newlyUnblockedSteps, nextReadyStep } from "./run-dependencies.js";

// Model requests are I/O-bound, but parsing/reference decoding share a small
// worker. Keep this bounded; admission enforces the same cap under a user lock.
export const SLIDE_PAGE_CONCURRENCY = 2;
export const isSlideGeneration = run => run.kind === "slides" && run.steps.some(step => step.tool === "slides.page");
export const inFlightStep = step => Boolean(step.jobId) && ["queued", "running"].includes(step.status);

export function nextSlideStep(run, jobs) {
  const active = run.steps.filter(inFlightStep), byId = new Map(jobs.map(job => [job.id, job]));
  // Publish/settle any completed page, even when an earlier page is slower.
  const settled = active.find(step => !byId.has(step.jobId) || ["succeeded", "failed", "cancelled"].includes(byId.get(step.jobId).status));
  if (settled) return settled;
  if (run.cancelRequestedAt) return active[0] || null;
  const ready = nextReadyStep(run.steps);
  if (ready && (ready.tool !== "slides.page" || active.filter(step => step.tool === "slides.page").length < SLIDE_PAGE_CONCURRENCY)) return ready;
  return active[0] || null;
}

export function slideRunProgress(steps) {
  const released = newlyUnblockedSteps(steps), ids = new Set(released.map(step => step.id));
  const current = steps.map(step => ids.has(step.id) ? { ...step, status: "ready" } : step);
  const ready = nextReadyStep(current), active = current.some(inFlightStep);
  const failure = current.find(step => ["failed", "cancelled"].includes(step.status));
  const status = ready || active ? "running" : failure ? "failed" : current.every(step => step.status === "succeeded") ? "succeeded" : "awaiting_input";
  return { released, ready, status, errorCode: status === "failed" ? failure.errorCode || failure.status : status === "awaiting_input" ? "CREATION_DEPENDENCY_BLOCKED" : null };
}

export function slideInsertionIndex(pages, outline, pageId) {
  const order = new Map(outline.pages.map((page, index) => [page.id, index]));
  const index = pages.findIndex(page => order.has(page.id) && order.get(page.id) > order.get(pageId));
  return index < 0 ? pages.length : index;
}
