import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportReview } from "../src/types.js";

const mocks = vi.hoisted(() => {
  const review: ReportReview = {
    overallAssessment: "Usable with caveats.",
    qualityScore: 80,
    citationAssessment: {
      hasUnsupportedClaims: false,
      unsupportedClaims: [],
      citationCoverage: "Citations are present."
    },
    sourceQuality: {
      strongSources: ["Example docs"],
      weakSources: [],
      marketingHeavy: false,
      notes: "Source set is small."
    },
    gaps: [],
    recommendations: ["Keep caveats."],
    readyForUse: true
  };

  return {
    review,
    runPlanner: vi.fn(),
    runResearchTask: vi.fn(),
    runCritic: vi.fn(),
    runWriter: vi.fn(),
    runReportReviewer: vi.fn()
  };
});

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
const { runResearch } = await import("../src/orchestrator.js");

describe("orchestrator report reviewer", () => {
  beforeEach(() => {
    mocks.runPlanner.mockReset();
    mocks.runPlanner.mockResolvedValue({
      plan: {
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
            focus: "web"
          }
        ]
      }
    });
    mocks.runResearchTask.mockReset();
    mocks.runResearchTask.mockResolvedValue({
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
    });
    mocks.runWriter.mockReset();
    mocks.runWriter.mockResolvedValue({ report: "# Topic\n\nReport with a citation [1].\n" });
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
    mocks.runReportReviewer.mockReset();
    mocks.runReportReviewer.mockResolvedValue({
      review: mocks.review,
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }
    });
  });

  it("writes report review artifacts and counts report reviewer usage", async () => {
    const config = await testConfig();

    const result = await runResearch(config, "test-key");
    const review = JSON.parse(await readFile(path.join(config.runDir, "report_review.json"), "utf8"));
    const markdown = await readFile(path.join(config.runDir, "report_review.md"), "utf8");
    const runSummary = await readFile(path.join(config.runDir, "run_summary.md"), "utf8");

    expect(result.reportReview?.readyForUse).toBe(true);
    expect(result.summaryPath).toBe(path.join(config.runDir, "run_summary.md"));
    expect(result.usage.callsByPhase.reportReviewer).toBe(1);
    expect(review.readyForUse).toBe(true);
    expect(markdown).toContain("Ready for use: yes");
    expect(runSummary).toContain("Report review readyForUse: true");
  });

  it("passes global Xiaomi timeout to non-writer roles and writer timeout to writer", async () => {
    const config = await testConfig({ xiaomiTimeoutMs: "180000", writerTimeoutMs: "300000" });

    await runResearch(config, "test-key");

    expect(mocks.runPlanner.mock.calls[0]?.[0].timeoutMs).toBe(180000);
    expect(mocks.runResearchTask.mock.calls[0]?.[0].xiaomiTimeoutMs).toBe(180000);
    expect(mocks.runCritic.mock.calls[0]?.[0].timeoutMs).toBe(180000);
    expect(mocks.runWriter.mock.calls[0]?.[0].timeoutMs).toBe(300000);
    expect(mocks.runReportReviewer.mock.calls[0]?.[0].timeoutMs).toBe(180000);
  });
});

async function testConfig(extra: Record<string, unknown> = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "research-xm-"));
  const promptPath = path.join(dir, "prompt.md");
  await writeFile(promptPath, "Research prompt", "utf8");

  return buildRunConfig({
    file: promptPath,
    outputDir: dir,
    profile: "smoke5",
    searchProvider: "opencode-web",
    maxTasks: 1,
    ...extra
  });
}
