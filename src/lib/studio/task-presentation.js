export function taskPhase(job, appliedJobs = [], resultStates = {}) {
  if (job.status === "succeeded") return resultStates[job.id] === "failed" ? "load-failed" : appliedJobs.includes(job.id) ? "complete" : "loading";
  return job.status;
}
export function taskSummary(jobs, appliedJobs, resultStates) {
  const phases = jobs.map(job => taskPhase(job, appliedJobs, resultStates));
  return { active: phases.filter(phase => !["complete", "failed", "cancelled", "load-failed"].includes(phase)).length,
    failed: phases.filter(phase => ["failed", "load-failed"].includes(phase)).length,
    complete: phases.length > 0 && phases.every(phase => phase === "complete") };
}
