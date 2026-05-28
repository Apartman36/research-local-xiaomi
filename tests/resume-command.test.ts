import { mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { printResumeCommand } from "../src/cli.js";

describe("resume command", () => {
  it("resumes the latest run", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "research-xm-resume-"));
    const oldRunId = "2026-05-27T21-31-57-984Z-xm";
    const runId = "2026-05-28T21-31-57-984Z-xm";
    const oldRunDir = path.join(outputDir, oldRunId);
    const runDir = path.join(outputDir, runId);
    await mkdir(oldRunDir);
    await mkdir(runDir);
    await touchRunDir(oldRunDir, "2026-05-29T00:00:00.000Z");
    await touchRunDir(runDir, "2026-05-28T21:31:57.984Z");
    await writeFile(path.join(runDir, "state.json"), JSON.stringify({ failedStage: "writer" }), "utf8");
    const resumeWorkflow = vi.fn(async (resolvedRunDir: string) => ({
      runId,
      runDir: resolvedRunDir,
      reportPath: path.join(resolvedRunDir, "report.md"),
      focus: "web",
      searchProvider: "opencode-web",
      researcherMode: "extract",
      usage: minimalUsage(),
      lintOk: true,
      lintUnknownNumbers: [],
      summaryPath: path.join(resolvedRunDir, "run_summary.md")
    }));

    const output = await printResumeCommand("latest", { outputDir }, { resumeWorkflow, apiKey: "test-key" });

    expect(resumeWorkflow).toHaveBeenCalledWith(runDir, "test-key", {});
    expect(output).toContain(`Resumed run: ${runId}`);
    expect(output).toContain(`Summary: ${path.join(runDir, "run_summary.md")}`);
  });

  it("passes resume CLI overrides", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "research-xm-resume-"));
    const runId = "2026-05-28T21-31-57-984Z-xm";
    const runDir = path.join(outputDir, runId);
    await mkdir(runDir);
    const resumeWorkflow = vi.fn(async () => ({
      runId,
      runDir,
      reportPath: path.join(runDir, "report.md"),
      focus: "web",
      searchProvider: "opencode-web",
      researcherMode: "extract",
      usage: minimalUsage(),
      lintOk: true,
      lintUnknownNumbers: []
    }));

    await printResumeCommand(
      runId,
      {
        outputDir,
        notify: true,
        verbose: true,
        xiaomiTimeoutMs: "180000",
        writerTimeoutMs: "300000",
        reviewReport: false
      },
      { resumeWorkflow, apiKey: "test-key" }
    );

    expect(resumeWorkflow).toHaveBeenCalledWith(runDir, "test-key", {
      notify: true,
      verbose: true,
      xiaomiTimeoutMs: 180000,
      writerTimeoutMs: 300000,
      reviewReport: false
    });
  });
});

async function touchRunDir(runDir: string, isoTimestamp: string): Promise<void> {
  const timestamp = new Date(isoTimestamp);
  await utimes(runDir, timestamp, timestamp);
}

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
