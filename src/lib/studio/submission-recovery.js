// Only a definitive rejection permits changing an unconfirmed paid request.
export function submissionRejected(error) {
  return error.status >= 400 && error.status < 500 && ![408, 425].includes(error.status) && error.code !== "IDEMPOTENCY_CONFLICT";
}

export function confirmedImageSubmission(draft, pending, job) {
  if (draft.pendingSubmit?.key !== pending.key) return draft;
  const batch = draft.pendingBatch;
  const index = batch?.keys.indexOf(pending.key) ?? -1;
  const plan = draft.plan;
  const planKey = plan && `${plan.id}-${plan.index}-${plan.attempt || 0}`;
  return { ...draft, pendingSubmit: null, jobs: [...new Set([...draft.jobs, job.id])].slice(-100),
    ...(index >= 0 ? { pendingBatch: index + 1 === batch.keys.length ? null : { ...batch, index: Math.max(batch.index, index + 1) } } : {}),
    ...(planKey === pending.key ? { plan: { ...plan, activeJob: job.id } } : {}),
  };
}
