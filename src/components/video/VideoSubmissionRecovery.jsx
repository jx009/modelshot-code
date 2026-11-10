"use client";

export default function VideoSubmissionRecovery({ project, zh, onRecovered }) {
  if (!project.pendingSubmission || project.working) return null;
  return <div className="vg-submission-recovery" role="status">
    <p>{zh ? "上次提交的响应尚未确认。请先恢复原任务，再提交新草稿。" : "The last submission is unconfirmed. Recover it before submitting a new draft."}</p>
    <button type="button" disabled={project.loading || project.loadFailed || project.applying} onClick={async () => { const job = await project.recoverSubmission(); if (job) onRecovered?.(job); }}>{zh ? "恢复上次提交" : "Recover previous submission"}</button>
  </div>;
}
