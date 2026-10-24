// Caller holds the run lock (always after the user lock). The event and state
// commit together; notifications can be retried without changing sequence.
export async function appendRunEvent(tx, runId, type, payload, changes = {}) {
  const run = await tx.creationRun.update({ where: { id: runId }, data: {
    ...changes, eventSequence: { increment: 1 },
  } });
  await tx.creationEvent.create({ data: { runId, sequence: run.eventSequence, type, payload } });
  const businessKey = `creation-notify:${runId}:${run.eventSequence}`;
  await tx.outboxEvent.create({ data: { businessKey, kind: "creation-notify", entityId: runId } });
  return run;
}

export async function enqueueRun(tx, runId, reason, availableAt = new Date()) {
  const businessKey = `creation:${runId}:${reason}`;
  await tx.outboxEvent.upsert({ where: { businessKey },
    create: { businessKey, kind: "creation-advance", entityId: runId, availableAt }, update: {},
  });
}
