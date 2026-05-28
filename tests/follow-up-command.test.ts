import { mkdir, mkdtemp, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { printFollowUpCommand } from "../src/cli.js";
import type { RunConfig } from "../src/types.js";

describe("follow-up command", () => {
  it("writes a follow-up prompt for the latest complete run", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "research-xm-follow-up-"));
    const runDir = path.join(outputDir, "2026-05-27T21-31-57-984Z-xm");
    await mkdir(runDir);
    await writeCompleteArtifacts(runDir);

    const output = await printFollowUpCommand("latest", { outputDir, writePromptOnly: true });
    const promptPath = path.join(runDir, "follow_up_prompt.md");
    const prompt = await readFile(promptPath, "utf8");

    expect(output).toBe(`Follow-up prompt written: ${promptPath}\n`);
    expect(prompt).toContain("# Follow-Up Research Task");
    expect(prompt).toContain("- Parent run ID: 2026-05-27T21-31-57-984Z-xm");
    expect(prompt).toContain("Independent benchmarks");
    expect(prompt).toContain("Check maintainer issue threads");
  });

  it("uses run id timestamp for latest after an older parent prompt write changes mtime", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "research-xm-follow-up-"));
    const oldRunId = "2026-05-27T21-31-57-984Z-xm";
    const newerRunId = "2026-05-28T21-31-57-984Z-xm";
    const oldRunDir = path.join(outputDir, oldRunId);
    const newerRunDir = path.join(outputDir, newerRunId);
    await mkdir(oldRunDir);
    await mkdir(newerRunDir);
    await writeCompleteArtifacts(oldRunDir);
    await writeCompleteArtifacts(newerRunDir);
    await writeFile(path.join(oldRunDir, "follow_up_prompt.md"), "# Existing parent follow-up prompt\n", "utf8");
    await touchRunDir(oldRunDir, "2026-05-29T00:00:00.000Z");
    await touchRunDir(newerRunDir, "2026-05-28T21:31:57.984Z");

    const output = await printFollowUpCommand("latest", { outputDir, writePromptOnly: true });

    expect(output).toBe(`Follow-up prompt written: ${path.join(newerRunDir, "follow_up_prompt.md")}\n`);
    const prompt = await readFile(path.join(newerRunDir, "follow_up_prompt.md"), "utf8");
    expect(prompt).toContain(`- Parent run ID: ${newerRunId}`);
  });

  it("handles a missing report review gracefully", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "research-xm-follow-up-"));
    const runDir = path.join(outputDir, "2026-05-27T21-31-57-984Z-xm");
    await mkdir(runDir);
    await writeCompleteArtifacts(runDir, { reportReview: false });

    await printFollowUpCommand("latest", { outputDir, writePromptOnly: true });
    const prompt = await readFile(path.join(runDir, "follow_up_prompt.md"), "utf8");

    expect(prompt).toContain("Missing inputs");
    expect(prompt).toContain("report_review.json");
    expect(prompt).toContain("report_review.md");
  });

  it("rejects an unknown explicit run", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "research-xm-follow-up-"));

    await expect(printFollowUpCommand("missing-run", { outputDir, writePromptOnly: true })).rejects.toThrow(
      "Run not found"
    );
  });

  it("requires exactly one safe mode", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "research-xm-follow-up-"));
    const runDir = path.join(outputDir, "2026-05-27T21-31-57-984Z-xm");
    await mkdir(runDir);

    await expect(printFollowUpCommand("latest", { outputDir, writePromptOnly: false, execute: false })).rejects.toThrow(
      "Exactly one of --write-prompt-only or --execute is required"
    );
    await expect(printFollowUpCommand("latest", { outputDir, writePromptOnly: true, execute: true })).rejects.toThrow(
      "Exactly one of --write-prompt-only or --execute is required"
    );
  });

  it("generates a prompt containing parentRunId and top gaps", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "research-xm-follow-up-"));
    const runDir = path.join(outputDir, "2026-05-27T21-31-57-984Z-xm");
    await mkdir(runDir);
    await writeCompleteArtifacts(runDir);

    await printFollowUpCommand("latest", { outputDir, writePromptOnly: true });
    const prompt = await readFile(path.join(runDir, "follow_up_prompt.md"), "utf8");

    expect(prompt).toContain("parentRunId: 2026-05-27T21-31-57-984Z-xm");
    expect(prompt).toContain("Independent benchmarks");
    await expect(stat(path.join(runDir, "follow_up_prompt.md"))).resolves.toBeTruthy();
  });

  it("executes a latest follow-up run with generated prompt and lineage metadata", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "research-xm-follow-up-"));
    const parentRunId = "2026-05-27T21-31-57-984Z-xm";
    const runDir = path.join(outputDir, parentRunId);
    await mkdir(runDir);
    await writeCompleteArtifacts(runDir);
    const runWorkflow = vi.fn(async (config: RunConfig) => ({
      runId: config.runId,
      runDir: config.runDir,
      reportPath: path.join(config.runDir, "report.md"),
      focus: config.focus,
      searchProvider: config.searchProvider,
      researcherMode: config.researcherMode,
      usage: minimalUsage(),
      lintOk: true,
      lintUnknownNumbers: [],
      summaryPath: path.join(config.runDir, "run_summary.md")
    }));

    const output = await printFollowUpCommand(
      "latest",
      {
        outputDir,
        writePromptOnly: false,
        execute: true,
        profile: "smoke5",
        focus: "github",
        searchProvider: "opencode-web",
        maxTasks: "2",
        xiaomiTimeoutMs: "180000",
        writerTimeoutMs: "300000"
      },
      { runWorkflow, apiKey: "test-key" }
    );

    expect(runWorkflow).toHaveBeenCalledTimes(1);
    const childConfig = runWorkflow.mock.calls[0]?.[0] as RunConfig;
    expect(childConfig.prompt).toContain("# Follow-Up Research Task");
    expect(childConfig.profile.name).toBe("smoke5");
    expect(childConfig.focus).toBe("github");
    expect(childConfig.searchProvider).toBe("opencode-web");
    expect(childConfig.maxTasks).toBe(2);
    expect(childConfig.xiaomiTimeoutMs).toBe(180000);
    expect(childConfig.writerTimeoutMs).toBe(300000);
    expect(childConfig.parentRunId).toBe(parentRunId);
    expect(childConfig.isFollowUpRun).toBe(true);
    expect(childConfig.followUpDepth).toBe(1);
    expect(childConfig.followUpPromptPath).toBe(path.join(runDir, "follow_up_prompt.md"));
    expect(childConfig.gapsAddressed).toContain("Independent benchmarks");
    expect(output).toContain("Follow-up prompt written:");
    expect(output).toContain("Follow-up run started:");
  });

  it("executes an explicit run id follow-up", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "research-xm-follow-up-"));
    const runDir = path.join(outputDir, "2026-05-27T21-31-57-984Z-xm");
    await mkdir(runDir);
    await writeCompleteArtifacts(runDir);
    const runWorkflow = vi.fn(async (config: RunConfig) => ({
      runId: config.runId,
      runDir: config.runDir,
      reportPath: path.join(config.runDir, "report.md"),
      focus: config.focus,
      searchProvider: config.searchProvider,
      researcherMode: config.researcherMode,
      usage: minimalUsage(),
      lintOk: true,
      lintUnknownNumbers: []
    }));

    await printFollowUpCommand(
      "2026-05-27T21-31-57-984Z-xm",
      { outputDir, writePromptOnly: false, execute: true },
      { runWorkflow, apiKey: "test-key" }
    );

    expect(runWorkflow).toHaveBeenCalledTimes(1);
    expect((runWorkflow.mock.calls[0]?.[0] as RunConfig).parentRunId).toBe("2026-05-27T21-31-57-984Z-xm");
  });

  it("rejects latest follow-up execution from an existing child run with parent guidance", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "research-xm-follow-up-"));
    const parentRunId = "2026-05-27T21-31-57-984Z-xm";
    const childRunId = "2026-05-28T21-31-57-984Z-xm";
    const childDir = path.join(outputDir, childRunId);
    await mkdir(childDir);
    await writeCompleteArtifacts(childDir);
    await writeFile(
      path.join(childDir, "config.json"),
      JSON.stringify({
        runId: childRunId,
        parentRunId,
        isFollowUpRun: true,
        followUpDepth: 1
      }),
      "utf8"
    );

    await expect(
      printFollowUpCommand("latest", { outputDir, writePromptOnly: false, execute: true })
    ).rejects.toThrow(
      `Latest run ${childRunId} is already a follow-up run at depth 1.\nFollow-up execution is limited to depth 1 in this release.\nUse the parent run instead:\nresearch-xm follow-up ${parentRunId} --execute`
    );
  });

  it("rejects explicit child follow-up execution with parent guidance", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "research-xm-follow-up-"));
    const parentRunId = "2026-05-27T21-31-57-984Z-xm";
    const childRunId = "2026-05-28T21-31-57-984Z-xm";
    const childDir = path.join(outputDir, childRunId);
    await mkdir(childDir);
    await writeCompleteArtifacts(childDir);
    await writeFile(
      path.join(childDir, "config.json"),
      JSON.stringify({
        runId: childRunId,
        parentRunId,
        isFollowUpRun: true,
        followUpDepth: 1
      }),
      "utf8"
    );

    await expect(
      printFollowUpCommand(childRunId, { outputDir, writePromptOnly: false, execute: true })
    ).rejects.toThrow(
      `Run ${childRunId} is already a follow-up run at depth 1.\nFollow-up execution is limited to depth 1 in this release.\nUse the parent run instead:\nresearch-xm follow-up ${parentRunId} --execute`
    );
  });

  it("still allows prompt-only generation from a child follow-up run", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "research-xm-follow-up-"));
    const childRunId = "2026-05-28T21-31-57-984Z-xm";
    const childDir = path.join(outputDir, childRunId);
    await mkdir(childDir);
    await writeCompleteArtifacts(childDir);
    await writeFile(
      path.join(childDir, "config.json"),
      JSON.stringify({
        runId: childRunId,
        parentRunId: "2026-05-27T21-31-57-984Z-xm",
        isFollowUpRun: true,
        followUpDepth: 1
      }),
      "utf8"
    );

    const output = await printFollowUpCommand(childRunId, { outputDir, writePromptOnly: true });

    expect(output).toBe(`Follow-up prompt written: ${path.join(childDir, "follow_up_prompt.md")}\n`);
  });
});

function minimalUsage() {
  return {
    totalCalls: 0,
    callsByPhase: {},
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    web_search_usage: { tool_usage: 0, page_usage: 0 },
    uniqueSources: 0,
    sourcesUsedInReport: 0,
    errors: 0,
    started_at: "2026-05-27T21:31:57.984Z",
    profile: "smoke5" as const,
    model: "mimo-v2.5-pro",
    xiaomi: { calls: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    opencode: {
      calls: 0,
      attempts: 0,
      websearch_calls: 0,
      webfetch_calls: 0,
      retries: 0,
      failures: 0,
      tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0 },
      cost: null
    },
    sources: { raw_sources: 0, unique_sources: 0, used_in_report: 0 }
  };
}

async function writeCompleteArtifacts(runDir: string, options: { reportReview?: boolean } = {}): Promise<void> {
  await writeFile(path.join(runDir, "input.md"), "# Topic\n\nResearch TypeScript CLI reliability patterns.", "utf8");
  await writeFile(
    path.join(runDir, "plan.json"),
    JSON.stringify({
      topic: "TypeScript CLI reliability patterns",
      objective: "Find practical implementation guidance.",
      subquestions: [
        { id: "SQ1", question: "How do mature CLIs keep retry behavior reliable?" },
        { id: "SQ2", question: "Which failure modes are common in agent research tools?" }
      ],
      searchTasks: []
    }),
    "utf8"
  );
  await writeFile(
    path.join(runDir, "critique.json"),
    JSON.stringify({
      summary: "Useful but missing independent operational evidence.",
      weakAreas: ["Too much vendor documentation"],
      missingCoverage: ["Independent benchmarks", "Maintainer issue threads"],
      duplicateEvidence: [],
      followUpTasks: [
        {
          id: "T900",
          subquestionId: "SQ1",
          query: "Check maintainer issue threads for CLI retry failure modes",
          depth: 1,
          focus: "github"
        }
      ],
      needsFollowUp: true
    }),
    "utf8"
  );
  await writeFile(
    path.join(runDir, "run_summary.md"),
    [
      "# Research Run Summary",
      "",
      "## Report Review Summary",
      "",
      "- readyForUse: false",
      "- qualityScore: 71",
      "- Top gaps:",
      "  - Independent benchmarks",
      "- Top recommendations:",
      "  - Check maintainer issue threads",
      "",
      "## Next Suggested Actions",
      "",
      "- Run targeted follow-up research on: Independent benchmarks."
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.join(runDir, "report.md"),
    "# Report\n\nCovered retry flags and source extraction. Uncovered subquestions: issue failure modes.\n",
    "utf8"
  );
  if (options.reportReview !== false) {
    await writeFile(
      path.join(runDir, "report_review.json"),
      JSON.stringify({
        overallAssessment: "Good foundation, but incomplete.",
        qualityScore: 71,
        citationAssessment: {
          hasUnsupportedClaims: false,
          unsupportedClaims: [],
          citationCoverage: "Mostly cited."
        },
        sourceQuality: {
          strongSources: ["Official docs"],
          weakSources: ["Vendor blog"],
          marketingHeavy: true,
          notes: "Needs independent evidence."
        },
        gaps: [
          {
            gap: "Independent benchmarks",
            whyItMatters: "Avoid vendor bias",
            suggestedFollowUpQuery: "TypeScript CLI retry benchmark failure modes"
          }
        ],
        recommendations: ["Check maintainer issue threads"],
        readyForUse: false
      }),
      "utf8"
    );
    await writeFile(path.join(runDir, "report_review.md"), "# Report Review\n\nQuality score: 71\n", "utf8");
  }
}

async function touchRunDir(runDir: string, isoTimestamp: string): Promise<void> {
  const timestamp = new Date(isoTimestamp);
  await utimes(runDir, timestamp, timestamp);
}
