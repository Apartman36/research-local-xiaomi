import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runPlanner: vi.fn(),
  runResearchTask: vi.fn(),
  runCritic: vi.fn(),
  runWriter: vi.fn(),
  runReportReviewer: vi.fn()
}));

vi.mock("../src/agents/planner.js", async () => {
  const actual = await vi.importActual<typeof import("../src/agents/planner.js")>("../src/agents/planner.js");
  return {
    ...actual,
    runPlanner: mocks.runPlanner
  };
});

vi.mock("../src/agents/researcher.js", () => ({
  runResearchTask: mocks.runResearchTask
}));

vi.mock("../src/agents/critic.js", () => ({
  runCritic: mocks.runCritic
}));

vi.mock("../src/agents/writer.js", () => ({
  runWriter: mocks.runWriter
}));

vi.mock("../src/agents/report-reviewer.js", async () => {
  const actual = await vi.importActual<typeof import("../src/agents/report-reviewer.js")>("../src/agents/report-reviewer.js");
  return {
    ...actual,
    runReportReviewer: mocks.runReportReviewer
  };
});

const { buildRunConfig } = await import("../src/config.js");
const { runResearch } = await import("../src/orchestrator.js");

describe("prompt preflight orchestration", () => {
  beforeEach(() => {
    mocks.runPlanner.mockReset();
    mocks.runPlanner.mockResolvedValue({ plan: validPlan() });
    mocks.runResearchTask.mockReset();
    mocks.runResearchTask.mockResolvedValue(validFinding());
    mocks.runCritic.mockReset();
    mocks.runCritic.mockResolvedValue({
      critique: {
        summary: "Good enough.",
        weakAreas: [],
        missingCoverage: [],
        duplicateEvidence: [],
        followUpTasks: [],
        needsFollowUp: false
      }
    });
    mocks.runWriter.mockReset();
    mocks.runWriter.mockResolvedValue({ report: "# SARYCH-LM\n\nClaim [1].\n" });
    mocks.runReportReviewer.mockReset();
    mocks.runReportReviewer.mockResolvedValue({
      review: {
        overallAssessment: "Usable.",
        citationAssessment: { hasUnsupportedClaims: false, unsupportedClaims: [], citationCoverage: "ok" },
        sourceQuality: { strongSources: [], weakSources: [], marketingHeavy: false, notes: "ok" },
        gaps: [],
        recommendations: [],
        readyForUse: true
      }
    });
  });

  it("passes normalized topic and objective to the planner", async () => {
    const config = await testConfig(sarychPrompt());

    await runResearch(config, "test-key");

    const plannerParams = mocks.runPlanner.mock.calls[0]?.[0];
    expect(plannerParams.normalizedRequest.researchTopic).toContain("SARYCH-LM");
    expect(plannerParams.normalizedRequest.researchObjective).toContain("Build and train");
    expect(plannerParams.normalizedRequest.questionsToAnswer).toBeDefined();
    expect(plannerParams.normalizedRequest.expectedOutputFormat).toBeDefined();
    expect(plannerParams.prompt).toContain("Role:");
    const normalized = JSON.parse(await readFile(path.join(config.runDir, "normalized_request.json"), "utf8"));
    const persistedConfig = JSON.parse(await readFile(path.join(config.runDir, "config.json"), "utf8"));
    expect(normalized.researchTopic).toContain("SARYCH-LM");
    expect(persistedConfig.promptNormalize).toBe(true);
  });

  it("rejects placeholder planner subquestions before search", async () => {
    const config = await testConfig("# Research Topic\nSARYCH-LM\n\n# Research Objective\nPlan local training.");
    mocks.runPlanner.mockResolvedValueOnce({
      plan: {
        topic: "Role:",
        objective: "Objective",
        assumptions: [],
        subquestions: [{ id: "SQ001", question: "Role:: research angle 1" }],
        searchTasks: [{ id: "T001", subquestionId: "SQ001", query: "Role:: research angle 1", depth: 1, focus: "web" }]
      }
    });

    await expect(runResearch(config, "test-key")).rejects.toThrow("planner_quality_failed");

    expect(mocks.runResearchTask).not.toHaveBeenCalled();
    const events = await readFile(path.join(config.runDir, "events.jsonl"), "utf8");
    expect(events).toContain("planner_quality_failed");
  });

  it("writes planner diagnostics and raw output when planner falls back", async () => {
    const config = await testConfig("# Research Topic\nSARYCH-LM\n\n# Research Objective\nPlan local PyTorch training.");
    mocks.runPlanner.mockResolvedValueOnce({
      plan: validPlan(),
      parseFailed: true,
      parseStatus: "fallback",
      fallbackUsed: true,
      parseError: "Unexpected token",
      rawContent: "not json",
      diagnostics: {
        schemaVersion: 1,
        parseStatus: "fallback",
        rawOutputPath: "./planner_raw.txt",
        warnings: ["Planner returned malformed JSON."],
        fallbackUsed: true,
        fallbackReason: "malformed_json",
        normalizedRequestSummary: {
          topic: "SARYCH-LM",
          questionsToAnswerCount: 0,
          mustCoverCount: 1,
          constraintsCount: 0
        }
      }
    });

    await runResearch(config, "test-key");

    expect(await readFile(path.join(config.runDir, "planner_raw.txt"), "utf8")).toBe("not json");
    const diagnostics = JSON.parse(await readFile(path.join(config.runDir, "planner_diagnostics.json"), "utf8"));
    expect(diagnostics.parseStatus).toBe("fallback");
    const events = await readFile(path.join(config.runDir, "events.jsonl"), "utf8");
    expect(events).toContain("planner_fallback_generated");
  });

  it("fails low-confidence prompts before planner or search", async () => {
    const config = await testConfig("Role:\nYou are a helpful researcher.\n", { dryRun: true });

    await expect(runResearch(config, "dry-run")).rejects.toThrow("The research prompt could not be normalized");

    expect(mocks.runPlanner).not.toHaveBeenCalled();
    expect(mocks.runResearchTask).not.toHaveBeenCalled();
    const events = await readFile(path.join(config.runDir, "events.jsonl"), "utf8");
    expect(events).toContain("prompt_preflight_failed");
  });

  it("--no-prompt-normalize preserves old planner behavior", async () => {
    const config = await testConfig("Role:\nYou are a helpful researcher.\n", { promptNormalize: false });
    mocks.runPlanner.mockResolvedValueOnce({
      plan: {
        topic: "Role:",
        objective: "Objective",
        assumptions: [],
        subquestions: [{ id: "SQ001", question: "Role:: research angle 1" }],
        searchTasks: [{ id: "T001", subquestionId: "SQ001", query: "Role:: research angle 1", depth: 1, focus: "web" }]
      }
    });

    await runResearch(config, "test-key");

    expect(mocks.runResearchTask).toHaveBeenCalled();
    const persistedConfig = JSON.parse(await readFile(path.join(config.runDir, "config.json"), "utf8"));
    expect(persistedConfig.promptNormalize).toBe(false);
  });
});

async function testConfig(prompt: string, extra: Record<string, unknown> = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "research-xm-preflight-"));
  const promptPath = path.join(dir, "prompt.md");
  await writeFile(promptPath, prompt, "utf8");
  return buildRunConfig({
    file: promptPath,
    outputDir: dir,
    profile: "smoke5",
    searchProvider: "opencode-web",
    maxTasks: 1,
    reviewReport: false,
    ...extra
  });
}

function sarychPrompt(): string {
  return `Role:
You are a senior ML infrastructure engineer specializing in PyTorch, CUDA, NVIDIA Blackwell GPUs, WSL2, and small language model training on consumer GPUs.

Context:
I am preparing a local machine learning project called SARYCH-LM.

Goal:
Build and train a small English-only language model from scratch, then later add distillation and possibly larger variants.

Questions to answer:
1. What CUDA stack should be used?

Expected output format:
- Version recommendation.`;
}

function validPlan() {
  return {
    topic: "SARYCH-LM local language model training",
    objective: "Plan local training.",
    assumptions: [],
    subquestions: [{ id: "SQ001", question: "What CUDA stack should be used for SARYCH-LM local PyTorch training?" }],
    searchTasks: [{ id: "T001", subquestionId: "SQ001", query: "SARYCH-LM PyTorch CUDA Blackwell WSL2 local LLM training", depth: 1, focus: "web" }]
  };
}

function validFinding() {
  return {
    taskId: "T001",
    subquestionId: "SQ001",
    query: "SARYCH-LM PyTorch CUDA local LLM training",
    assistantSynthesis: "Found source.",
    annotations: [
      {
        url: "https://example.com/source",
        canonicalUrl: "https://example.com/source",
        title: "Source",
        summary: "Summary",
        siteName: "Example"
      }
    ],
    claims: [
      {
        id: "T001-C001",
        subquestionId: "SQ001",
        taskId: "T001",
        text: "Claim.",
        sourceIds: ["https://example.com/source"],
        confidence: "medium"
      }
    ],
    providerResult: { provider: "opencode-web", sources: [], rawEventsCount: 0, usage: { calls: 1, attempts: 1 } }
  };
}
