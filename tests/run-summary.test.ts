import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateRunSummary, getRunSummaryPath } from "../src/store/run-summary.js";
import type { ReportReview, Source, UsageSummary } from "../src/types.js";

describe("run summary", () => {
  it("generates a compact summary from complete artifacts", async () => {
    const runDir = await fixtureRunDir();
    await writeCompleteArtifacts(runDir);

    const result = await generateRunSummary(runDir);
    const markdown = await readFile(result.path, "utf8");

    expect(result.path).toBe(path.join(runDir, "run_summary.md"));
    expect(markdown).toContain("# Research Run Summary");
    expect(markdown).toContain("- Run ID:");
    expect(markdown).toContain("- Report: ./report.md");
    expect(markdown).toContain("- Citation lint: ok");
    expect(markdown).toContain("- Report review readyForUse: false");
    expect(markdown).toContain("- Report review readinessScore: -1 / weak");
    expect(markdown).toContain("- Xiaomi calls: 5");
    expect(markdown).toContain("- Researcher calls: 2");
    expect(markdown).toContain("- OpenCode attempts: 3");
    expect(markdown).toContain("- OpenCode retries: 1");
    expect(markdown).toContain("- OpenCode failures: 1");
    expect(markdown).toContain("- Last OpenCode error: timeout");
    expect(markdown).toContain("- OpenCode tokens: unavailable (early exit)");
    expect(markdown).toContain("## Report Review Summary");
    expect(markdown).toContain("- Investigate independent benchmarks");
    expect(markdown).toContain("## Source Summary");
    expect(markdown).toContain("- Warning: report review marked source quality as marketing-heavy.");
    expect(markdown).toContain("## Next Suggested Actions");
    expect(markdown).toContain("Run targeted follow-up research");
  });

  it("generates a partial summary when optional report review is missing", async () => {
    const runDir = await fixtureRunDir();
    await writeCompleteArtifacts(runDir, { reportReview: false });

    const result = await generateRunSummary(runDir);
    const markdown = await readFile(result.path, "utf8");

    expect(markdown).toContain("- Report review: missing");
    expect(markdown).toContain("- Report review readyForUse: unavailable");
    expect(markdown).toContain("- overallAssessment: unavailable");
  });

  it("does not crash incomplete runs", async () => {
    const runDir = await fixtureRunDir();
    await writeFile(path.join(runDir, "report.md"), "# Draft\n", "utf8");

    const result = await generateRunSummary(runDir);
    const markdown = await readFile(result.path, "utf8");

    expect(result.missingArtifacts).toContain("usage.json");
    expect(markdown).toContain("- Usage: missing");
    expect(markdown).toContain("- Partial run: yes");
    expect(markdown).toContain("- Researcher calls: 0 / not reached");
  });

  it("derives OpenCode attempts from events when usage has no successful calls", async () => {
    const runDir = await fixtureRunDir();
    await writeCompleteArtifacts(runDir, { reportReview: false });
    const usage = JSON.parse(await readFile(path.join(runDir, "usage.json"), "utf8")) as UsageSummary;
    usage.opencode.calls = 0;
    usage.opencode.attempts = 0;
    usage.opencode.retries = 0;
    usage.opencode.failures = 0;
    await writeFile(path.join(runDir, "usage.json"), JSON.stringify(usage), "utf8");
    await writeFile(
      path.join(runDir, "events.jsonl"),
      [
        JSON.stringify({ type: "opencode_search_started", taskId: "T001", query: "q" }),
        JSON.stringify({ type: "opencode_search_attempt_started", taskId: "T001", query: "q", attempt: 1, maxAttempts: 3 }),
        JSON.stringify({ type: "opencode_search_attempt_failed", taskId: "T001", query: "q", error: "timeout" })
      ].join("\n"),
      "utf8"
    );

    const result = await generateRunSummary(runDir);
    const markdown = await readFile(result.path, "utf8");

    expect(markdown).toContain("- OpenCode attempts: 1");
    expect(markdown).toContain("- OpenCode successful calls: 0");
    expect(markdown).toContain("- OpenCode failures: 1");
    expect(markdown).toContain("- Last OpenCode error: timeout");
  });

  it("returns the expected summary path", async () => {
    const runDir = await fixtureRunDir();
    expect(getRunSummaryPath(runDir)).toBe(path.join(runDir, "run_summary.md"));
  });

  it("still displays legacy qualityScore for old report review artifacts", async () => {
    const runDir = await fixtureRunDir();
    await writeCompleteArtifacts(runDir, { legacyQualityScore: true });

    const result = await generateRunSummary(runDir);
    const markdown = await readFile(result.path, "utf8");

    expect(markdown).toContain("- Report review qualityScore: 72");
  });

  it("shows reviewer parsing fallback when present", async () => {
    const runDir = await fixtureRunDir();
    await writeCompleteArtifacts(runDir, { parseFallback: true });

    const result = await generateRunSummary(runDir);
    const markdown = await readFile(result.path, "utf8");

    expect(markdown).toContain("- Report review parsing: fallback");
  });
});

async function fixtureRunDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "research-xm-summary-"));
}

async function writeCompleteArtifacts(
  runDir: string,
  options: { reportReview?: boolean; legacyQualityScore?: boolean; parseFallback?: boolean } = {}
): Promise<void> {
  const config = {
    runId: path.basename(runDir),
    startedAt: "2026-05-26T21:31:57.984Z",
    profile: { name: "normal100" },
    focus: "web",
    searchProvider: "opencode-web",
    researcherMode: "extract",
    model: "mimo-v2.5-pro",
    dryRun: false
  };
  const usage: UsageSummary = {
    totalCalls: 5,
    callsByPhase: { planner: 1, researcher: 2, critic: 1, writer: 1 },
    prompt_tokens: 100,
    completion_tokens: 50,
    total_tokens: 150,
    web_search_usage: { tool_usage: 0, page_usage: 0 },
    uniqueSources: 2,
    sourcesUsedInReport: 1,
    errors: 0,
    started_at: "2026-05-26T21:31:57.984Z",
    finished_at: "2026-05-26T21:37:48.984Z",
    duration_seconds: 351,
    profile: "normal100",
    model: "mimo-v2.5-pro",
    xiaomi: { calls: 5, prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    opencode: {
      calls: 2,
      attempts: 3,
      websearch_calls: 2,
      webfetch_calls: 0,
      retries: 1,
      failures: 1,
      last_error: "timeout",
      tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0 },
      tokensUnavailable: true,
      cost: null
    },
    sources: { raw_sources: 3, unique_sources: 2, used_in_report: 1 }
  };
  const sources: Source[] = [
    {
      id: "S001",
      citationIndex: 1,
      url: "https://docs.example.com/a",
      canonicalUrl: "https://docs.example.com/a",
      title: "Docs",
      siteName: "Docs Example",
      firstSeenInTaskId: "T001",
      seenCount: 2
    },
    {
      id: "S002",
      citationIndex: 2,
      url: "https://vendor.example.com/b",
      canonicalUrl: "https://vendor.example.com/b",
      title: "Vendor",
      firstSeenInTaskId: "T002",
      seenCount: 1
    }
  ];
  const review: ReportReview = {
    overallAssessment: "Useful, but needs stronger independent evidence.",
    readinessScore: -1,
    scoreLabel: "weak",
    topGaps: ["Independent benchmarks", "Pricing", "API limits", "Older tools"],
    topRecommendations: ["Investigate independent benchmarks", "Check pricing", "Validate API limits", "Plan follow-up"],
    sourceQualityNotes: ["Several vendor sources."],
    followUpQueries: ["independent benchmark"],
    citationAssessment: {
      hasUnsupportedClaims: false,
      unsupportedClaims: [],
      citationCoverage: "Mostly cited."
    },
    sourceQuality: {
      strongSources: ["Docs Example"],
      weakSources: ["Vendor"],
      marketingHeavy: true,
      notes: "Several vendor sources."
    },
    gaps: [
      { gap: "Independent benchmarks", whyItMatters: "Avoid vendor bias", suggestedFollowUpQuery: "independent benchmark" },
      { gap: "Pricing", whyItMatters: "Cost planning" },
      { gap: "API limits", whyItMatters: "Implementation risk" },
      { gap: "Older tools", whyItMatters: "Historical context" }
    ],
    recommendations: ["Investigate independent benchmarks", "Check pricing", "Validate API limits", "Plan follow-up"],
    readyForUse: false,
    parseFallback: options.parseFallback
  };

  await writeFile(path.join(runDir, "config.json"), JSON.stringify(config), "utf8");
  await writeFile(path.join(runDir, "usage.json"), JSON.stringify(usage), "utf8");
  await writeFile(path.join(runDir, "sources.json"), JSON.stringify(sources), "utf8");
  await writeFile(path.join(runDir, "evidence.json"), JSON.stringify({ rawAnnotationCount: 3 }), "utf8");
  await writeFile(path.join(runDir, "report.md"), "# Report\n\nClaim [1].\n", "utf8");
  await writeFile(path.join(runDir, "events.jsonl"), "{\"type\":\"citation_lint_completed\",\"ok\":true,\"sourcesUsed\":1}\n", "utf8");
  if (options.reportReview !== false) {
    const persistedReview = options.legacyQualityScore
      ? {
          ...review,
          readinessScore: undefined,
          scoreLabel: undefined,
          topGaps: undefined,
          topRecommendations: undefined,
          sourceQualityNotes: undefined,
          followUpQueries: undefined,
          parseFallback: undefined,
          qualityScore: 72
        }
      : review;
    await writeFile(path.join(runDir, "report_review.json"), JSON.stringify(persistedReview), "utf8");
    await writeFile(path.join(runDir, "report_review.md"), "# Review\n", "utf8");
  }
}
