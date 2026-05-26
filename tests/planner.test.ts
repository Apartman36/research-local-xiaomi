import { describe, expect, it } from "vitest";
import { fallbackPlan, parsePlanContent } from "../src/agents/planner.js";
import { smoke5 } from "../src/profiles/smoke5.js";

describe("planner parsing", () => {
  it("coerces invalid task focus to config focus", () => {
    const parsed = parsePlanContent(
      JSON.stringify({
        topic: "Topic",
        objective: "Objective",
        assumptions: [],
        subquestions: [{ id: "SQ001", question: "Question" }],
        searchTasks: [
          {
            id: "T001",
            subquestionId: "SQ001",
            query: "query",
            depth: 1,
            focus: "documentation"
          }
        ]
      }),
      { prompt: "Prompt", profile: smoke5, focus: "web" }
    );

    expect(parsed.plan.searchTasks[0]?.focus).toBe("web");
    expect(parsed.coercions).toEqual([
      {
        taskId: "T001",
        originalFocus: "documentation",
        coercedTo: "web"
      }
    ]);
  });

  it("defaults missing task focus to config focus without failing", () => {
    const parsed = parsePlanContent(
      JSON.stringify({
        topic: "Topic",
        objective: "Objective",
        assumptions: [],
        subquestions: [{ id: "SQ001", question: "Question" }],
        searchTasks: [
          {
            id: "T001",
            subquestionId: "SQ001",
            query: "query",
            depth: 1
          }
        ]
      }),
      { prompt: "Prompt", profile: smoke5, focus: "github" }
    );

    expect(parsed.plan.searchTasks[0]?.focus).toBe("github");
    expect(parsed.coercions).toHaveLength(0);
  });

  it("uses a fallback plan for malformed planner JSON", () => {
    const parsed = parsePlanContent('{"topic":"broken","searchTasks":[}', {
      prompt: "Custom research prompt",
      profile: smoke5,
      focus: "web"
    });

    expect(parsed.parseFailed).toBe(true);
    expect(parsed.plan.searchTasks.length).toBeGreaterThan(0);
    expect(parsed.plan.searchTasks[0]?.query).toContain("Custom research prompt");
  });

  it("exports fallback plans with at least one task", () => {
    const plan = fallbackPlan("Fallback topic", smoke5, "web", "Planner failed.");

    expect(plan.searchTasks.length).toBeGreaterThan(0);
    expect(plan.assumptions).toContain("Planner failed.");
  });
});
