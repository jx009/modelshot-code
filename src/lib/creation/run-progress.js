export function runProgress(run) {
  const steps = run?.steps || [];
  const complete = steps.filter(step => step.status === "succeeded");
  const failed = steps.filter(step => step.status === "failed");
  const running = steps.filter(step => step.status === "running");
  const active = ["queued", "running", "cancelling"].includes(run?.status);
  const pages = steps.filter(step => step.tool === "slides.page");
  return { complete, failed, running, active, total: steps.length,
    pages: pages.length, publishedPages: pages.filter(step => step.status === "succeeded" && step.result?.artifactId).length,
    percent: steps.length ? Math.round(complete.length / steps.length * 100) : 0,
    tone: run?.status === "failed" ? "failed" : run?.status === "succeeded" ? "succeeded" : active ? "running" : "paused" };
}
