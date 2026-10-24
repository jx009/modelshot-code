import { expect, it } from "vitest";
import { dependenciesFor, newlyUnblockedSteps, nextReadyStep, runHasUnfinishedSteps, validateRunDependencyGraph } from "../../src/lib/creation/run-dependencies.js";

it("accepts bounded acyclic dependency graphs and rejects missing nodes, cycles, and duplicate edges", () => {
  const valid = [
    { id: "brief", position: 0, dependsOn: [], status: "succeeded" },
    { id: "poster", position: 1, dependsOn: ["brief"], status: "ready" },
    { id: "slides", position: 2, dependsOn: ["poster"], status: "blocked" },
    { id: "copy", position: 3, dependsOn: ["brief"], status: "blocked" },
  ];
  expect(validateRunDependencyGraph(valid)).toBe(true);
  expect(validateRunDependencyGraph([{ ...valid[0], dependsOn: ["missing"] }])).toBe(false);
  expect(validateRunDependencyGraph([{ ...valid[0], dependsOn: ["brief"] }])).toBe(false);
  expect(validateRunDependencyGraph([{ ...valid[0], dependsOn: ["brief", "brief"] }])).toBe(false);
});

it("preserves the historical sequential order when old in-memory steps have no dependency field", () => {
  const steps = [
    { id: "one", position: 0, status: "succeeded" },
    { id: "two", position: 1, status: "ready" },
    { id: "three", position: 2, status: "blocked" },
  ];
  expect(dependenciesFor(steps[2], steps)).toEqual(["two"]);
  expect(nextReadyStep(steps)).toBe(steps[1]);
  expect(validateRunDependencyGraph(steps)).toBe(true);
});

it("releases only steps whose declared dependencies have completed", () => {
  const steps = [
    { id: "source", position: 0, dependsOn: [], status: "running" },
    { id: "poster", position: 1, dependsOn: ["source"], status: "blocked" },
    { id: "slides", position: 2, dependsOn: ["poster"], status: "blocked" },
    { id: "copy", position: 3, dependsOn: ["source"], status: "blocked" },
  ];
  expect(newlyUnblockedSteps(steps, new Set(["source"])).map(step => step.id)).toEqual(["poster", "copy"]);
  steps[1].status = "succeeded";
  expect(newlyUnblockedSteps(steps, new Set(["source"])).map(step => step.id)).toEqual(["slides", "copy"]);
});

it("accepts the maximum existing PPT plan and distinguishes blocked plans from completed runs", () => {
  const steps = [{ id: "outline", position: 0, dependsOn: [], status: "succeeded" }];
  for (let index = 0; index < 100; index += 1) {
    steps.push({ id: `page-${index}`, position: index + 1, dependsOn: [index ? `page-${index - 1}` : "outline"], status: "blocked" });
  }
  steps.push({ id: "assemble", position: 101, dependsOn: steps.slice(1).map(step => step.id), status: "blocked" });
  expect(validateRunDependencyGraph(steps)).toBe(true);
  expect(runHasUnfinishedSteps(steps)).toBe(true);
  expect(runHasUnfinishedSteps(steps.map(step => ({ ...step, status: "succeeded" })))).toBe(false);
});
