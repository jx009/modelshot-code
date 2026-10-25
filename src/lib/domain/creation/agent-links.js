import { AppError } from "../../http.js";
import { lockRun } from "./runs.js";
import { appendRunEvent, enqueueRun } from "./events.js";

// Internal relationship, not a public request field. Both directions must match
// before a child can share its parent's admission slot or wake the parent.
export async function verifiedAgentParent(tx, child) {
  const link = child.input?.agentParent;
  if (!link) return null;
  const parent = await lockRun(tx, child.userId, link.runId);
  if (parent.kind !== "agent" || parent.projectId !== child.projectId || parent.sessionId !== child.sessionId
    || parent.steps.find(step => step.id === link.stepId)?.result?.childRunId !== child.id) throw new AppError("CREATION_AGENT_LINK_INVALID", 409);
  if (parent.cancelRequestedAt || ["cancelled", "succeeded"].includes(parent.status)) throw new AppError("CREATION_PUBLICATION_STOPPED", 409);
  return parent;
}
export async function wakeAgentParent(tx, child) {
  const parent = await verifiedAgentParent(tx, child);
  if (!parent) return;
  const next = await appendRunEvent(tx, parent.id, "agent.child_resumed", { childRunId: child.id }, { status: "running", errorCode: null, nextCheckAt: new Date() });
  await enqueueRun(tx, parent.id, `child:${next.eventSequence}`);
}
