import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fallbackPlan, parsePlanContent, validatePlanQuality } from "../src/agents/planner.js";
import { normalizePromptDeterministic } from "../src/agents/prompt-normalizer.js";
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

  it("repairs fenced and prose-surrounded planner JSON", () => {
    const parsed = parsePlanContent(
      `Here is the plan:
\`\`\`json
{
  "topic": "SARYCH-LM local training",
  "objective": "Plan local training",
  "assumptions": [],
  "subquestions": [{"id": "SQ001", "question": "What CUDA stack supports Blackwell?"}],
  "searchTasks": [{"id": "T001", "subquestionId": "SQ001", "query": "PyTorch CUDA Blackwell WSL2 support", "depth": 1, "focus": "web",}]
}
\`\`\`
Done.`,
      {
        prompt: "Custom research prompt",
        profile: smoke5,
        focus: "web"
      }
    );

    expect(parsed.parseStatus).toBe("repaired");
    expect(parsed.fallbackUsed).not.toBe(true);
    expect(parsed.plan.topic).toContain("SARYCH-LM");
  });

  it("uses a diagnostic fallback for malformed planner JSON that cannot be repaired", () => {
    const parsed = parsePlanContent('{"topic":"broken","searchTasks":[}', {
      prompt: "Custom research prompt",
      profile: smoke5,
      focus: "web"
    });

    expect(parsed.parseFailed).toBe(true);
    expect(parsed.parseStatus).toBe("fallback");
    expect(parsed.rawContent).toContain("broken");
    expect(parsed.diagnostics?.fallbackReason).toBe("malformed_json");
    expect(parsed.plan.searchTasks.length).toBeGreaterThan(0);
    expect(parsed.plan.searchTasks[0]?.query).toContain("Custom research prompt");
  });

  it("exports normalized-request fallback plans with SARYCH-specific diverse questions", async () => {
    const prompt = await readFile(path.join(process.cwd(), "tests/fixtures/sarych-lm-prompt.md"), "utf8");
    const normalized = normalizePromptDeterministic(prompt);
    const plan = fallbackPlan(prompt, smoke5, "web", "Planner failed.", normalized);

    expect(plan.searchTasks.length).toBeGreaterThan(0);
    expect(plan.assumptions).toContain("Planner failed.");
    expect(plan.topic).toContain("SARYCH-LM");
    expect(plan.subquestions.length).toBeGreaterThanOrEqual(8);
    expect(new Set(plan.subquestions.map((item) => item.question.toLowerCase())).size).toBe(plan.subquestions.length);
    expect(plan.subquestions.map((item) => item.question).join("\n")).toMatch(/Blackwell|WSL2|tokenizer|distillation/);
    expect(plan.searchTasks.map((item) => item.query).join("\n")).toMatch(/PyTorch.*CUDA.*Blackwell|tokenizer|distillation/);
    expect(JSON.stringify(plan)).not.toMatch(/research angle|Role::|Dry-run fallback subquestion/i);
  });

  it("rejects repeated generic fallback plans during quality validation", async () => {
    const prompt = await readFile(path.join(process.cwd(), "tests/fixtures/sarych-lm-prompt.md"), "utf8");
    const normalizedRequest = normalizePromptDeterministic(prompt);
    const plan = {
      topic: "SARYCH-LM",
      objective: "Plan local training.",
      assumptions: ["Planner returned malformed JSON; deterministic fallback plan was used."],
      subquestions: Array.from({ length: 10 }, (_, index) => ({
        id: `SQ${String(index + 1).padStart(3, "0")}`,
        question: "What concrete decisions are required to satisfy the objective for SARYCH-LM?"
      })),
      searchTasks: Array.from({ length: 10 }, (_, index) => ({
        id: `T${String(index + 1).padStart(3, "0")}`,
        subquestionId: `SQ${String(index + 1).padStart(3, "0")}`,
        query: "What concrete decisions are required to satisfy the objective for SARYCH-LM?",
        depth: 1,
        focus: "web" as const
      }))
    };

    expect(() => validatePlanQuality(plan, normalizedRequest)).toThrow("planner_quality_failed");
  });
});
