import { describe, expect, it, vi } from "vitest";

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
