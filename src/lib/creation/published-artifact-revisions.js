// Steps may complete out of order. Revision numbers are comparable only within
// one artifact, never between separate outputs of an agent run.
export function publishedArtifactRevisions(steps = []) {
  const revisions = {};
  for (const step of steps) {
    const result = step.result;
    if (step.status !== "succeeded" || typeof result?.artifactId !== "string"
      || !Number.isInteger(result.revision) || result.revision < 1) continue;
    revisions[result.artifactId] = Math.max(revisions[result.artifactId] || 0, result.revision);
  }
  return revisions;
}
