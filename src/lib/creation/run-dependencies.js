import { z } from "zod";

export const runDependenciesSchema = z.array(z.string().min(1).max(128)).max(102).refine(ids => new Set(ids).size === ids.length);

export function dependenciesFor(step, steps) {
  if (Array.isArray(step.dependsOn)) return step.dependsOn;
  if (step.position <= 0) return [];
  const previous = steps.find(candidate => candidate.position === step.position - 1);
  return previous ? [previous.id] : [];
}

export function validateRunDependencyGraph(steps) {
  // Outline + up to 100 pages + two shared illustrations + assembly.
  if (!Array.isArray(steps) || steps.length > 104) return false;
  const ids = new Set(steps.map(step => step.id));
  if (ids.size !== steps.length) return false;
  const byId = new Map(steps.map(step => [step.id, step]));
  const visiting = new Set(), visited = new Set();
  function visit(id) {
    if (visiting.has(id)) return false;
    if (visited.has(id)) return true;
    const step = byId.get(id);
    if (!step) return false;
    visiting.add(id);
    const dependencies = dependenciesFor(step, steps);
    if (!runDependenciesSchema.safeParse(dependencies).success || dependencies.some(dependency => !byId.has(dependency) || !visit(dependency))) return false;
    visiting.delete(id);
    visited.add(id);
    return true;
  }
  return [...ids].every(visit);
}

export function runHasUnfinishedSteps(steps) {
  return steps.some(step => step.status !== "succeeded");
}

export function nextReadyStep(steps, succeededIds = new Set()) {
  return steps.find(step => step.status === "ready" && dependenciesFor(step, steps).every(id => succeededIds.has(id) || steps.some(candidate => candidate.id === id && candidate.status === "succeeded"))) || null;
}

export function newlyUnblockedSteps(steps, succeededIds = new Set()) {
  return steps.filter(step => step.status === "blocked" && dependenciesFor(step, steps).every(id => succeededIds.has(id) || steps.some(candidate => candidate.id === id && candidate.status === "succeeded")));
}
