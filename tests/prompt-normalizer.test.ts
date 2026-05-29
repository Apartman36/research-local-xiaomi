import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  chat: vi.fn()
}));

vi.mock("../src/providers/xiaomi.js", async () => {
  const actual = await vi.importActual<typeof import("../src/providers/xiaomi.js")>("../src/providers/xiaomi.js");
  return {
    ...actual,
    chat: mocks.chat
  };
});

const {
  normalizePromptDeterministic,
  runPromptNormalizer,
  validateNormalizedRequest,
  validatePlanPreflight
} = await import("../src/agents/prompt-normalizer.js");

describe("prompt normalizer", () => {
  beforeEach(() => {
    mocks.chat.mockReset();
  });

  it("parses a SARYCH-style structured Markdown prompt into rich fields", async () => {
    const prompt = await readFile(path.join(process.cwd(), "tests/fixtures/sarych-lm-prompt.md"), "utf8");

    const normalized = normalizePromptDeterministic(prompt);

    expect(normalized.researchTopic).toMatch(/SARYCH-LM/i);
    expect(normalized.researchTopic).toMatch(/local|small|English-only|from scratch|distillation/i);
    expect(normalized.researchObjective).toMatch(/train|from scratch|distillation/i);
    expect(normalized.questionsToAnswer.length).toBeGreaterThanOrEqual(10);
    expect(normalized.questionsToAnswer[0]).toMatchObject({
      id: "Q001",
      sourceSection: "Questions to Answer"
    });
    expect(normalized.expectedOutputFormat).toEqual(expect.arrayContaining(["Recommended software versions.", "Distillation plan."]));
    expect(normalized.outputRequirements).toEqual(expect.arrayContaining(["Recommended software versions.", "Distillation plan."]));
    expect(normalized.constraints).toEqual(expect.arrayContaining(["English-only model for the MVP.", "Training must run locally."]));
    expect(normalized.hardwareContext).toEqual(expect.arrayContaining(["NVIDIA Blackwell GPU on Windows with WSL2."]));
    expect(normalized.projectRoadmap).toContain("Train a baseline model from scratch.");
    expect(normalized.candidateDependencies).toEqual(expect.arrayContaining(["PyTorch", "CUDA toolkit"]));
    expect(normalized.importantNotes).toContain("Do not assume cloud training.");
    expect(normalized.mustCover).toEqual(
      expect.arrayContaining(["PyTorch", "CUDA", "NVIDIA Blackwell", "WSL2", "tokenizer", "datasets", "checkpointing", "distillation"])
    );
    expect(normalized.confidence).toBe("high");
  });

  it("extracts SARYCH-LM from role/context prompt templates", () => {
    const normalized = normalizePromptDeterministic(`Role:
You are a senior ML infrastructure engineer specializing in PyTorch, CUDA, NVIDIA Blackwell GPUs, WSL2, and small language model training on consumer GPUs.

Context:
I am preparing a local machine learning project called SARYCH-LM.

Goal:
Build and train a small English-only language model from scratch, then later add distillation and possibly larger variants.

Output Requirements:
- Include datasets, tokenizer, memory, checkpointing, evaluation, and a distillation roadmap.
`);

    expect(normalized.researchTopic).toContain("SARYCH-LM");
    expect(normalized.researchTopic).not.toMatch(/^Role:?$/);
    expect(normalized.researchObjective).toContain("Build and train");
    expect(normalized.mustCover).toEqual(expect.arrayContaining(["PyTorch", "CUDA", "WSL2", "tokenizer", "distillation"]));
    expect(normalized.detectedPromptSections).toEqual(expect.arrayContaining(["Role", "Context", "Goal", "Output Requirements"]));
    expect(normalized.confidence).toBe("high");
  });

  it("auto mode calls the LLM when many sections are detected but key fields are missing", async () => {
    mocks.chat.mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: "assistant",
            content: JSON.stringify({
              schemaVersion: 1,
              researchTopic: "Structured prompt research",
              researchObjective: "Extract a reliable research plan from the structured prompt.",
              userContext: "A long structured prompt was provided.",
              constraints: ["Use local artifacts."],
              mustCover: ["Planner"],
              outputRequirements: ["Plan quality diagnostics."],
              negativeRequirements: [],
              questionsToAnswer: [{ id: "Q001", question: "What should be planned?", sourceSection: "Custom Questions" }],
              hardwareContext: [],
              projectRoadmap: [],
              candidateDependencies: [],
              importantNotes: [],
              expectedOutputFormat: ["Plan quality diagnostics."],
              detectedPromptSections: ["Role", "Context", "Custom Questions", "Deliverables", "Important"],
              normalizationMode: "llm",
              normalizationWarnings: [],
              confidence: "medium",
              warnings: [],
              rawInputSha256: "model-value"
            })
          }
        }
      ],
      usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 }
    });

    const result = await runPromptNormalizer({
      apiKey: "test-key",
      baseUrl: "https://example.test/v1",
      model: "mimo-v2.5-pro",
      maxCompletionTokens: 1000,
      prompt: `Role:
Researcher.

Context:
Long context.

Custom Questions:
- What should be planned?

Deliverables:
- Plan quality diagnostics.

Important:
- Preserve sections.
`,
      dryRun: false,
      mode: "auto"
    });

    expect(result.usedModel).toBe(true);
    expect(result.normalized.normalizationMode).toBe("hybrid");
    expect(result.normalized.questionsToAnswer).toHaveLength(1);
    expect(result.usage?.total_tokens).toBe(18);
  });

  it("writes raw malformed LLM normalizer output metadata and falls back deterministically", async () => {
    mocks.chat.mockResolvedValueOnce({
      choices: [{ message: { role: "assistant", content: "not json" } }],
      usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 }
    });

    const result = await runPromptNormalizer({
      apiKey: "test-key",
      baseUrl: "https://example.test/v1",
      model: "mimo-v2.5-pro",
      maxCompletionTokens: 1000,
      prompt: "# Research Topic\nSARYCH-LM\n\n# Research Objective\nPlan local PyTorch training.",
      dryRun: false,
      mode: "llm"
    });

    expect(result.usedModel).toBe(true);
    expect(result.rawContent).toBe("not json");
    expect(result.normalized.researchTopic).toBe("SARYCH-LM");
    expect(result.normalized.normalizationWarnings.join("\n")).toContain("malformed JSON");
  });

  it("handles explicit research headings deterministically", () => {
    const normalized = normalizePromptDeterministic(`# Research Topic
SARYCH-LM local training stack

# Research Objective
Design a practical local training plan for a small English-only language model.

# Must Cover
- PyTorch
- CUDA
- Tokenizer
`);

    expect(normalized.researchTopic).toBe("SARYCH-LM local training stack");
    expect(normalized.researchObjective).toContain("Design a practical");
    expect(normalized.mustCover).toEqual(expect.arrayContaining(["PyTorch", "CUDA", "Tokenizer"]));
    expect(normalized.confidence).toBe("high");
  });

  it("rejects low-confidence normalized requests", () => {
    const normalized = normalizePromptDeterministic("Role:\nYou are a helpful researcher.\n");

    expect(() => validateNormalizedRequest(normalized)).toThrow("The research prompt could not be normalized");
  });

  it("rejects placeholder planner output before search", () => {
    expect(() =>
      validatePlanPreflight({
        topic: "Role:",
        subquestions: [{ question: "Role:: research angle 1" }],
        searchTasks: [{ query: "Role:: research angle 1" }]
      })
    ).toThrow("The research prompt could not be normalized");
  });

  it("counts model-based normalizer usage when deterministic confidence is low", async () => {
    mocks.chat.mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: "assistant",
            content: JSON.stringify({
              schemaVersion: 1,
              researchTopic: "Local language model training",
              researchObjective: "Create a plan for local small-language-model training.",
              userContext: "User supplied a role-only template.",
              constraints: [],
              mustCover: ["PyTorch"],
              outputRequirements: [],
              negativeRequirements: [],
              detectedPromptSections: ["Role"],
              confidence: "medium",
              warnings: [],
              rawInputSha256: "model-value"
            })
          }
        }
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
    });

    const result = await runPromptNormalizer({
      apiKey: "test-key",
      baseUrl: "https://example.test/v1",
      model: "mimo-v2.5-pro",
      maxCompletionTokens: 1000,
      prompt: "Role:\nYou are a helpful researcher.\n",
      dryRun: false
    });

    expect(result.usedModel).toBe(true);
    expect(result.usage?.total_tokens).toBe(15);
    expect(result.normalized.researchTopic).toBe("Local language model training");
    expect(result.normalized.rawInputSha256).toHaveLength(64);
  });
});
