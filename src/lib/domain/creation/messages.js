// Caller holds the owning user/run lock. Sequence, message and project recency
// share its transaction; retries never append duplicate dialogue bubbles.
export async function appendCreationMessage(tx, sessionId, clientKey, role, text, references = []) {
  const old = await tx.creationMessage.findUnique({ where: { sessionId_clientKey: { sessionId, clientKey } } });
  if (old) return old;
  const session = await tx.creationSession.update({ where: { id: sessionId }, data: { sequence: { increment: 1 } } });
  const message = await tx.creationMessage.create({ data: { sessionId, clientKey, sequence: session.sequence, role, text, references } });
  await tx.creationProject.update({ where: { id: session.projectId }, data: { updatedAt: new Date() } });
  return message;
}
