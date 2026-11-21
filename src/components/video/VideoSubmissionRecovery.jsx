"use client";

// 提交结果未知时只有两个安全出口：沿用同一幂等键恢复原请求，或明确放弃后重新提交。
// 放弃只清本地凭据；服务端若已入队，结果仍会通过任务轮询回到工程里。
export default function VideoSubmissionRecovery({ project, zh, onRecovered }) {
  if (!project.pendingSubmission || project.working) return null;
  return <div className="vg-submission-recovery" role="status">
    <p>{zh ? "上次提交的响应尚未确认。请先恢复原任务，再提交新草稿。" : "The last submission is unconfirmed. Recover it before submitting a new draft."}</p>
    <div className="vg-submission-actions">
      <button type="button" disabled={project.loading || project.loadFailed || project.applying} onClick={async () => { const job = await project.recoverSubmission(); if (job) onRecovered?.(job); }}>{zh ? "恢复上次提交" : "Recover previous submission"}</button>
      <button type="button" className="is-quiet" onClick={() => project.discardSubmission()}>{zh ? "放弃，重新提交" : "Discard and submit again"}</button>
    </div>
  </div>;
}
