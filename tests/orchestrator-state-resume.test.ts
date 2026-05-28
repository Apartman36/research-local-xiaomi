import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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

vi.mock("../src/agents/planner.js", () => ({
  runPlanner: mocks.runPlanner
}));

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
const { resumeResearch, runResearch } = await import("../src/orchestrator.js");

describe("orchestrator state and resume", () => {
  beforeEach(() => {
    mocks.runPlanner.mockReset();
    mocks.runPlanner.mockResolvedValue({
      plan: samplePlan()
    });
    mocks.runResearchTask.mockReset();
    mocks.runResearchTask.mockResolvedValue(sampleFinding());
    mocks.runCritic.mockReset();
    mocks.runCritic.mockResolvedValue({
      critique: sampleCritique()
    });
    mocks.runWriter.mockReset();
    mocks.runWriter.mockResolvedValue({ report: "# Topic\n\nReport with a citation [1].\n", usage: { total_tokens: 1 } });
    mocks.runReportReviewer.mockReset();
    mocks.runReportReviewer.mockResolvedValue({
      review: sampleReview(),
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }
    });
  });

  it("writes completed state after a successful run", async () => {
    const config = await testConfig();

    await runResearch(config, "test-key");

    const state = JSON.parse(await readFile(path.join(config.runDir, "state.json"), "utf8"));
    expect(state.status).toBe("completed");
    expect(state.currentStage).toBe("completed");
    expect(state.completedStages).toEqual([
      "planner",
      "search",
      "researcher",
      "critic",
      "writer",
      "reportReviewer",
      "citationLint",
      "summary"
    ]);
    expect(state.canResume).toBe(false);
  });

  it("writes failed writer state when writer throws", async () => {
    const config = await testConfig();
    mocks.runWriter.mockRejectedValueOnce(new Error("writer timeout"));

    await expect(runResearch(config, "test-key")).rejects.toThrow("writer timeout");

    const state = JSON.parse(await readFile(path.join(config.runDir, "state.json"), "utf8"));
    expect(state.status).toBe("failed");
    expect(state.failedStage).toBe("writer");
    expect(state.canResume).toBe(true);
    expect(state.completedStages).toContain("critic");
  });

  it("resumes a failed writer run without rerunning planner/search/researcher/critic", async () => {
    const config = await testConfig();
    await writeResumableArtifacts(config);

    const result = await resumeResearch(config.runDir, "test-key", {});

    expect(result.runId).toBe(config.runId);
    expect(mocks.runPlanner).not.toHaveBeenCalled();
    expect(mocks.runResearchTask).not.toHaveBeenCalled();
    expect(mocks.runCritic).not.toHaveBeenCalled();
    expect(mocks.runWriter).toHaveBeenCalledTimes(1);
    expect(mocks.runReportReviewer).toHaveBeenCalledTimes(1);
    const state = JSON.parse(await readFile(path.join(config.runDir, "state.json"), "utf8"));
    const events = await readFile(path.join(config.runDir, "events.jsonl"), "utf8");
    expect(state.status).toBe("completed");
    expect(events).toContain("\"type\":\"resume_started\"");
    expect(events).toContain("\"type\":\"resume_completed\"");
  });

  it("fails resume clearly when required writer artifacts are missing", async () => {
    const config = await testConfig();
    await mkdir(config.runDir, { recursive: true });
    await writeFile(path.join(config.runDir, "input.md"), config.prompt, "utf8");
    await writeFile(path.join(config.runDir, "config.json"), JSON.stringify(stripPrompt(config)), "utf8");
    await writeFile(
      path.join(config.runDir, "state.json"),
      JSON.stringify({
        schemaVersion: 1,
        runId: config.runId,
        status: "failed",
        currentStage: "writer",
        completedStages: ["planner", "search", "researcher", "critic"],
        failedStage: "writer",
        lastError: "writer timeout",
        updatedAt: "2026-05-28T00:00:00.000Z",
        canResume: true,
        artifacts: {}
      }),
      "utf8"
    );

    await expect(resumeResearch(config.runDir, "test-key", {})).rejects.toThrow(
      "Cannot resume from stage writer because required artifacts are missing: plan.json, sources.json, evidence.json, critique.json"
    );
  });
});

async function testConfig() {
  const dir = await mkdtemp(path.join(tmpdir(), "research-xm-state-"));
  const promptPath = path.join(dir, "prompt.md");
  await writeFile(promptPath, "Research prompt", "utf8");

  return buildRunConfig({
    file: promptPath,
    outputDir: dir,
    profile: "smoke5",
    searchProvider: "opencode-web",
    maxTasks: 1
  });
}

async function writeResumableArtifacts(config: Awaited<ReturnType<typeof testConfig>>) {
  await mkdir(config.runDir, { recursive: true });
  await writeFile(path.join(config.runDir, "input.md"), config.prompt, "utf8");
  await writeFile(path.join(config.runDir, "config.json"), JSON.stringify(stripPrompt(config)), "utf8");
  await writeFile(path.join(config.runDir, "plan.json"), JSON.stringify(samplePlan()), "utf8");
  await writeFile(path.join(config.runDir, "queries.json"), JSON.stringify(samplePlan().searchTasks), "utf8");
  await writeFile(path.join(config.runDir, "sources.json"), JSON.stringify(sampleSources()), "utf8");
  await writeFile(path.join(config.runDir, "evidence.json"), JSON.stringify(sampleEvidence()), "utf8");
  await writeFile(path.join(config.runDir, "critique.json"), JSON.stringify(sampleCritique()), "utf8");
  await writeFile(
    path.join(config.runDir, "state.json"),
    JSON.stringify({
      schemaVersion: 1,
      runId: config.runId,
      status: "failed",
      currentStage: "writer",
      completedStages: ["planner", "search", "researcher", "critic"],
      failedStage: "writer",
      lastError: "writer timeout",
      updatedAt: "2026-05-28T00:00:00.000Z",
      canResume: true,
      artifacts: {}
    }),
    "utf8"
  );
}

function stripPrompt(config: Awaited<ReturnType<typeof testConfig>>) {
  const { prompt: _prompt, ...rest } = config;
  return rest;
}

function samplePlan() {
  return {
    topic: "Topic",
    objective: "Objective",
    assumptions: [],
    subquestions: [{ id: "SQ001", question: "Question" }],
    searchTasks: [{ id: "T001", subquestionId: "SQ001", query: "query", depth: 1, focus: "web" }]
  };
}

function sampleFinding() {
  return {
    taskId: "T001",
    subquestionId: "SQ001",
    query: "query",
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
    ]
  };
}

function sampleSources() {
  return [
    {
      id: "S001",
      citationIndex: 1,
      url: "https://example.com/source",
      canonicalUrl: "https://example.com/source",
      title: "Source",
      summary: "Summary",
      siteName: "Example",
      firstSeenInTaskId: "T001",
      seenCount: 1,
      focus: "web"
    }
  ];
}

function sampleEvidence() {
  return {
    generatedAt: "2026-05-28T00:00:00.000Z",
    claims: [{ id: "T001-C001", subquestionId: "SQ001", taskId: "T001", text: "Claim.", sourceIds: ["S001"], confidence: "medium" }],
    sourceCount: 1,
    rawAnnotationCount: 1
  };
}

function sampleCritique() {
  return {
    summary: "Good enough.",
    weakAreas: [],
    missingCoverage: [],
    duplicateEvidence: [],
    followUpTasks: [],
    needsFollowUp: false
  };
}

function sampleReview() {
  return {
    overallAssessment: "Usable.",
    readinessScore: 1,
    scoreLabel: "useful",
    topGaps: [],
    topRecommendations: [],
    sourceQualityNotes: [],
    followUpQueries: [],
    citationAssessment: {
      hasUnsupportedClaims: false,
      unsupportedClaims: [],
      citationCoverage: "Cited."
    },
    sourceQuality: {
      strongSources: ["Example"],
      weakSources: [],
      marketingHeavy: false,
      notes: "Good enough."
    },
    gaps: [],
    recommendations: [],
    readyForUse: true
  };
}
