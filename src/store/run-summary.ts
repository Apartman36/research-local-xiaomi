import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { lintCitations } from "../evidence/citation-linter.js";
import type { CitationLintResult, ReportReview, Source, UsageSummary } from "../types.js";
import { writeTextArtifact } from "./run-store.js";

const ARTIFACTS = [
  "report.md",
  "normalized_request.md",
  "planner_diagnostics.json",
  "planner_raw.txt",
  "report_review.md",
  "sources.json",
  "evidence.json",
  "critique.json",
  "usage.json",
  "events.jsonl",
  "state.json",
  "citation_lint.json",
  "findings"
] as const;

export type GenerateRunSummaryResult = {
  path: string;
  markdown: string;
  missingArtifacts: string[];
};

type RunSummaryContext = {
  runDir: string;
  runId: string;
  config?: any;
  usage?: UsageSummary;
  sources?: Source[];
  evidence?: any;
  review?: ReportReview;
  plannerDiagnostics?: any;
  lint?: CitationLintResult;
  opencodeDiagnostics: OpenCodeDiagnostics;
  existingArtifacts: Set<string>;
  missingArtifacts: string[];
};

type OpenCodeDiagnostics = {
  attempts?: number;
  retries?: number;
  failures?: number;
  lastError?: string;
  successfulCalls?: number;
};

export function getRunSummaryPath(runDir: string): string {
  return path.join(runDir, "run_summary.md");
}

export async function generateRunSummary(runDir: string): Promise<GenerateRunSummaryResult> {
  const context = await loadRunSummaryContext(runDir);
  const markdown = renderRunSummary(context);
  await writeTextArtifact(runDir, "run_summary.md", markdown);
  return {
    path: getRunSummaryPath(runDir),
    markdown,
    missingArtifacts: context.missingArtifacts
  };
}

export async function listRunArtifacts(runDir: string): Promise<string[]> {
  try {
    const entries = (await readdir(runDir, { recursive: true })) as string[];
    const files: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(runDir, entry);
      if ((await stat(fullPath)).isFile()) {
        files.push(entry);
      }
    }
    return files.sort();
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }
    throw error;
  }
}

async function loadRunSummaryContext(runDir: string): Promise<RunSummaryContext> {
  const [config, usage, sources, evidence, review, plannerDiagnostics, report, eventsText, existingFiles] = await Promise.all([
    readOptionalJson(path.join(runDir, "config.json")),
    readOptionalJson<UsageSummary>(path.join(runDir, "usage.json")),
    readOptionalJson<Source[]>(path.join(runDir, "sources.json")),
    readOptionalJson(path.join(runDir, "evidence.json")),
    readOptionalJson<ReportReview>(path.join(runDir, "report_review.json")),
    readOptionalJson(path.join(runDir, "planner_diagnostics.json")),
    readOptionalText(path.join(runDir, "report.md")),
    readOptionalText(path.join(runDir, "events.jsonl")),
    listRunArtifacts(runDir)
  ]);
  const existingArtifacts = new Set(existingFiles.map((file) => file.split(/[\\/]/)[0] ?? file));
  const missingArtifacts = ARTIFACTS.filter((artifact) => !existingArtifacts.has(artifact));
  const lint = report && sources ? lintCitations(report, sources) : undefined;

  return {
    runDir,
    runId: path.basename(runDir),
    config,
    usage,
    sources,
    evidence,
    review,
    plannerDiagnostics,
    lint,
    opencodeDiagnostics: buildOpenCodeDiagnostics(usage, eventsText),
    existingArtifacts,
    missingArtifacts
  };
}

function renderRunSummary(context: RunSummaryContext): string {
  const usage = context.usage;
  const config = context.config;
  const review = context.review;
  const partial = context.missingArtifacts.includes("usage.json") || Boolean(usage?.errors && usage.errors > 0);
  const rawSources = numeric(context.evidence?.rawAnnotationCount, usage?.sources?.raw_sources);
  const uniqueSources = numeric(usage?.uniqueSources, usage?.sources?.unique_sources, context.sources?.length);
  const deduplicated = rawSources === undefined || uniqueSources === undefined ? undefined : Math.max(0, rawSources - uniqueSources);
  const topDomains = summarizeTopDomains(context.sources ?? []);
  const nextActions = buildNextActions(context);
  const opencode = context.opencodeDiagnostics;

  return [
    "# Research Run Summary",
    "",
    "## Status",
    "",
    `- Run ID: ${context.runId}`,
    `- Started: ${value(usage?.started_at ?? config?.startedAt)}`,
    `- Finished: ${value(usage?.finished_at)}`,
    `- Duration: ${formatDuration(usage?.duration_seconds)}`,
    `- Profile: ${value(usage?.profile ?? config?.profile?.name)}`,
    `- Focus: ${value(config?.focus)}`,
    `- Search provider: ${value(config?.searchProvider)}`,
    `- Researcher mode: ${value(config?.researcherMode)}`,
    `- Model: ${value(usage?.model ?? config?.model)}`,
    `- Dry run: ${yesNo(config?.dryRun)}`,
    "",
    "## Outputs",
    "",
    ...ARTIFACTS.map((artifact) => `- ${artifactLabel(artifact)}: ${context.existingArtifacts.has(artifact) ? `./${artifact}` : "missing"}`),
    "",
    "## Quality",
    "",
    `- Planner parse status: ${value(context.plannerDiagnostics?.parseStatus)}`,
    `- Planner fallback: ${context.plannerDiagnostics ? yesNo(Boolean(context.plannerDiagnostics.fallbackUsed)) : "unavailable"}`,
    `- Planner diagnostics: ${context.existingArtifacts.has("planner_diagnostics.json") ? "./planner_diagnostics.json" : "missing"}`,
    ...(context.existingArtifacts.has("planner_raw.txt") ? ["- Planner raw output: ./planner_raw.txt"] : []),
    `- Citation lint: ${context.lint ? (context.lint.ok ? "ok" : "failed") : "unavailable"}`,
    `- Cited sources: ${value(context.lint?.sourcesUsed ?? usage?.sourcesUsedInReport)}`,
    `- Unique sources: ${value(uniqueSources)}`,
    `- Sources used in report: ${value(usage?.sourcesUsedInReport ?? usage?.sources?.used_in_report)}`,
    `- Errors: ${value(usage?.errors)}`,
    `- Partial run: ${partial ? "yes" : "no"}`,
    `- Report review readyForUse: ${review ? String(review.readyForUse) : "unavailable"}`,
    `- ${formatReviewScoreLine(review)}`,
    ...(review?.validationWarning ? [`- Report review warning: ${formatReviewWarning(review.validationWarning)}`] : []),
    ...(review?.parseFallback ? ["- Report review parsing: fallback"] : []),
    ...(review?.parseFallback ? ["- Report review raw output: ./report_review_raw.txt"] : []),
    "",
    "## Usage",
    "",
    `- Xiaomi calls: ${value(usage?.xiaomi.calls ?? usage?.totalCalls)}`,
    `- Planner calls: ${phaseCalls(usage, "planner")}`,
    `- Prompt normalizer calls: ${phaseCalls(usage, "promptNormalizer")}`,
    `- Researcher calls: ${phaseCalls(usage, "researcher")}`,
    `- Critic calls: ${phaseCalls(usage, "critic")}`,
    `- Writer calls: ${phaseCalls(usage, "writer")}`,
    `- Report reviewer calls: ${phaseCalls(usage, "reportReviewer")}`,
    `- Xiaomi total tokens: ${value(usage?.xiaomi.total_tokens ?? usage?.total_tokens)}`,
    `- Xiaomi prompt tokens: ${value(usage?.xiaomi.prompt_tokens ?? usage?.prompt_tokens)}`,
    `- Xiaomi completion tokens: ${value(usage?.xiaomi.completion_tokens ?? usage?.completion_tokens)}`,
    `- OpenCode calls: ${value(usage?.opencode?.calls)}`,
    `- OpenCode attempts: ${value(opencode.attempts)}`,
    `- OpenCode successful calls: ${value(opencode.successfulCalls ?? usage?.opencode?.calls)}`,
    `- OpenCode retries: ${value(opencode.retries)}`,
    `- OpenCode failures: ${value(opencode.failures)}`,
    `- Last OpenCode error: ${value(opencode.lastError)}`,
    `- OpenCode websearch calls: ${value(usage?.opencode?.websearch_calls)}`,
    `- OpenCode webfetch calls: ${value(usage?.opencode?.webfetch_calls)}`,
    `- OpenCode tokens: ${formatOpenCodeTokens(usage)}`,
    "",
    "## Token Accounting",
    "",
    ...renderTokenAccountingLines(usage),
    "",
    "## Report Review Summary",
    "",
    `- overallAssessment: ${value(review?.overallAssessment)}`,
    `- readyForUse: ${review ? String(review.readyForUse) : "unavailable"}`,
    `- ${formatReviewSummaryScoreLine(review)}`,
    ...topReviewItems("Top gaps", review?.topGaps ?? review?.gaps.map((gap) => gap.gap)),
    ...topReviewItems("Top recommendations", review?.topRecommendations ?? review?.recommendations),
    "",
    "## Source Summary",
    "",
    `- Raw sources: ${value(rawSources)}`,
    `- Unique sources: ${value(uniqueSources)}`,
    `- Deduplicated count: ${value(deduplicated)}`,
    `- Top domains/sites: ${topDomains.length > 0 ? topDomains.join(", ") : "unavailable"}`,
    ...(review?.sourceQuality.marketingHeavy ? ["- Warning: report review marked source quality as marketing-heavy."] : []),
    "",
    "## Next Suggested Actions",
    "",
    ...nextActions.map((action) => `- ${action}`),
    ""
  ].join("\n");
}

function buildNextActions(context: RunSummaryContext): string[] {
  const actions: string[] = [];
  if (context.review?.readyForUse === false) {
    const gap = context.review.gaps[0]?.suggestedFollowUpQuery ?? context.review.gaps[0]?.gap;
    actions.push(`Run targeted follow-up research${gap ? ` on: ${gap}` : " using the reviewer gaps"}.`);
  }
  if (context.lint && !context.lint.ok) {
    actions.push("Check report citations against sources.json.");
  }
  if ((context.usage?.errors ?? 0) > 0) {
    actions.push("Check events.jsonl for failed phases or partial task errors.");
  }
  const uniqueSources = context.usage?.uniqueSources ?? context.sources?.length ?? 0;
  if (context.usage && uniqueSources < 5) {
    actions.push("Rerun with a higher --max-tasks value if broader coverage is needed.");
  }
  if (actions.length === 0) {
    actions.push("Use report.md and report_review.md for the next implementation planning step.");
  }
  return actions;
}

function topReviewItems(label: string, items: string[] | undefined): string[] {
  const top = (items ?? []).slice(0, 3);
  if (top.length === 0) {
    return [`- ${label}: unavailable`];
  }
  return [`- ${label}:`, ...top.map((item) => `  - ${item}`)];
}

function formatReviewScoreLine(review: ReportReview | undefined): string {
  if (!review) {
    return "Report review readinessScore: unavailable";
  }
  if (typeof review.readinessScore === "number") {
    return `Report review readinessScore: ${review.readinessScore} / ${review.scoreLabel ?? "unlabeled"}`;
  }
  if (typeof review.qualityScore === "number") {
    return `Report review qualityScore: ${review.qualityScore}`;
  }
  return "Report review readinessScore: unavailable";
}

function formatReviewSummaryScoreLine(review: ReportReview | undefined): string {
  if (!review) {
    return "readinessScore: unavailable";
  }
  if (typeof review.readinessScore === "number") {
    return `readinessScore: ${review.readinessScore} / ${review.scoreLabel ?? "unlabeled"}`;
  }
  if (typeof review.qualityScore === "number") {
    return `qualityScore: ${review.qualityScore}`;
  }
  return "readinessScore: unavailable";
}

function summarizeTopDomains(sources: Source[]): string[] {
  const counts = new Map<string, number>();
  for (const source of sources) {
    const key = source.siteName?.trim() || domainFromUrl(source.canonicalUrl || source.url);
    if (key) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([domain, count]) => `${domain} (${count})`);
}

function domainFromUrl(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function artifactLabel(artifact: string): string {
  const labels: Record<string, string> = {
    "report.md": "Report",
    "normalized_request.md": "Normalized request",
    "planner_diagnostics.json": "Planner diagnostics",
    "planner_raw.txt": "Planner raw output",
    "report_review.md": "Report review",
    "sources.json": "Sources",
    "evidence.json": "Evidence",
    "critique.json": "Critique",
    "usage.json": "Usage",
    "events.jsonl": "Events",
    "state.json": "State",
    "citation_lint.json": "Citation lint",
    findings: "Findings"
  };
  return labels[artifact] ?? artifact;
}

function formatReviewWarning(warning: string): string {
  return warning.includes("invalid readinessScore")
    ? "invalid readinessScore; normalized conservatively"
    : warning;
}

async function readOptionalJson<T = any>(filePath: string): Promise<T | undefined> {
  const text = await readOptionalText(filePath);
  if (text === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

async function readOptionalText(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
  }
}

function formatDuration(seconds: number | undefined): string {
  return seconds === undefined ? "unavailable" : `${seconds}s`;
}

function formatOpenCodeTokens(usage: UsageSummary | undefined): string {
  if (!usage) {
    return "unavailable";
  }
  if (!usage.opencode) {
    return "unavailable";
  }
  if (usage.opencode.tokensUnavailable) {
    return "unavailable (early exit)";
  }
  return String(usage.opencode.tokens.total);
}

function renderTokenAccountingLines(usage: UsageSummary | undefined): string[] {
  const accounting = usage?.tokenAccounting;
  if (!usage) {
    return ["- Token accounting: unavailable"];
  }
  if (!accounting) {
    return [
      "- Token accounting: legacy usage format",
      `- Direct Xiaomi tokens: ${value(usage.xiaomi?.total_tokens ?? usage.total_tokens)}`,
      `- OpenCode tokens: ${formatOpenCodeTokens(usage)}`
    ];
  }
  const completeness = accounting.total.isLowerBound
    ? `${accounting.total.tokenAccountingCompleteness} / lower-bound`
    : accounting.total.tokenAccountingCompleteness;
  return [
    `- Direct Xiaomi tokens: ${accounting.directXiaomi.totalTokens}`,
    `- OpenCode tokens: ${accounting.openCode.known ? value(accounting.openCode.tokens) : "unavailable"}`,
    `- Estimated OpenCode tokens: ${accounting.openCode.estimatedTokens}`,
    `- Estimated total tokens: ${accounting.total.estimatedTotalTokens}`,
    `- Accounting completeness: ${completeness}`,
    `- Quota risk: ${accounting.quotaRiskLevel}`,
    ...accounting.warnings.map((warning) => `- Warning: ${warning}`)
  ];
}

function phaseCalls(usage: UsageSummary | undefined, phase: string): string {
  const calls = usage?.callsByPhase?.[phase];
  if (typeof calls === "number") {
    return String(calls);
  }
  return "0 / not reached";
}

function value(input: unknown): string {
  if (input === undefined || input === null || input === "") {
    return "unavailable";
  }
  return String(input);
}

function yesNo(input: unknown): string {
  if (typeof input !== "boolean") {
    return "unavailable";
  }
  return input ? "yes" : "no";
}

function numeric(...values: unknown[]): number | undefined {
  for (const input of values) {
    if (typeof input === "number" && Number.isFinite(input)) {
      return input;
    }
  }
  return undefined;
}

function buildOpenCodeDiagnostics(usage: UsageSummary | undefined, eventsText: string | undefined): OpenCodeDiagnostics {
  let eventAttempts = 0;
  let eventRetries = 0;
  let eventFailures = 0;
  let eventSuccessfulCalls = 0;
  let eventLastError: string | undefined;
  const diagnostics: OpenCodeDiagnostics = {
    attempts: numeric(usage?.opencode?.attempts),
    retries: numeric(usage?.opencode?.retries),
    failures: numeric(usage?.opencode?.failures),
    lastError: usage?.opencode?.last_error,
    successfulCalls: numeric(usage?.opencode?.calls)
  };
  if (!eventsText) {
    return diagnostics;
  }
  for (const line of eventsText.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (event.type === "opencode_search_attempt_started") {
      eventAttempts += 1;
    } else if (event.type === "opencode_search_retry") {
      eventRetries += 1;
      eventLastError = stringValue(event.error) ?? eventLastError;
    } else if (event.type === "opencode_search_attempt_failed") {
      eventFailures += 1;
      eventLastError = stringValue(event.error) ?? eventLastError;
    } else if (event.type === "opencode_search_completed") {
      eventSuccessfulCalls += 1;
    } else if (event.type === "opencode_search_failed") {
      eventLastError = stringValue(event.error) ?? eventLastError;
    }
  }
  diagnostics.attempts = maxDefined(diagnostics.attempts, eventAttempts);
  diagnostics.retries = maxDefined(diagnostics.retries, eventRetries);
  diagnostics.failures = maxDefined(diagnostics.failures, eventFailures);
  diagnostics.successfulCalls = maxDefined(diagnostics.successfulCalls, eventSuccessfulCalls);
  diagnostics.lastError = diagnostics.lastError ?? eventLastError;
  return diagnostics;
}

function maxDefined(existing: number | undefined, derived: number): number | undefined {
  if (existing === undefined && derived === 0) {
    return undefined;
  }
  return Math.max(existing ?? 0, derived);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
