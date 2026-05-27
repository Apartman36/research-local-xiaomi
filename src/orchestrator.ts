import path from "node:path";
import { lintCitations } from "./evidence/citation-linter.js";
import { dedupeSources } from "./evidence/dedupe-sources.js";
import { citationIndexBySourceId, sourceIdByCanonicalUrl } from "./evidence/source-ids.js";
import { runCritic } from "./agents/critic.js";
import { runPlanner } from "./agents/planner.js";
import { renderReportReviewMarkdown, runReportReviewer } from "./agents/report-reviewer.js";
import { runResearchTask } from "./agents/researcher.js";
import { runWriter } from "./agents/writer.js";
import { OpenCodeWebSearchProvider } from "./search/opencode-websearch.js";
import type { SearchProvider } from "./search/search-provider.js";
import { isXiaomiNativeWebSearchDisabled, XiaomiNativeWebSearchProvider } from "./search/xiaomi-native-websearch.js";
import { EventLogger } from "./store/events.js";
import { generateRunSummary, getRunSummaryPath } from "./store/run-summary.js";
import { createRunDirectory, writeFinding, writeJsonArtifact, writeTextArtifact } from "./store/run-store.js";
import { UsageTracker } from "./store/usage.js";
import type { Critique, EvidenceClaim, EvidenceFile, Finding, Plan, ReportReview, RunConfig, SearchTask, Source, UsageSummary } from "./types.js";

export type RunResult = {
  runId: string;
  runDir: string;
  reportPath: string;
  focus: string;
  searchProvider: string;
  researcherMode: string;
  usage: UsageSummary;
  lintOk: boolean;
  lintUnknownNumbers: number[];
  reportReview?: ReportReview;
  summaryPath?: string;
};

export async function runResearch(config: RunConfig, apiKey: string): Promise<RunResult> {
  await createRunDirectory(config.runDir);
  const events = new EventLogger(path.join(config.runDir, "events.jsonl"), config.verbose);
  const usage = new UsageTracker(config.startedAt, config.profile.name, config.model);
  let completed = false;

  try {
  await events.log("research_started", {
    runId: config.runId,
    profile: config.profile.name,
    focus: config.focus,
    searchProvider: config.searchProvider,
    model: config.model,
    researcherMode: config.researcherMode,
    dryRun: config.dryRun
  });
  await events.log("search_provider_selected", { provider: config.searchProvider });
  await writeTextArtifact(config.runDir, "input.md", config.prompt);
  await writeJsonArtifact(config.runDir, "config.json", sanitizeConfig(config));

  await events.log("planner_started");
  const plannerResult = await runPlanner({
    apiKey,
    baseUrl: config.apiBaseUrl,
    model: config.roleModels.planner,
    maxCompletionTokens: config.maxOutputTokens.planner,
    prompt: config.prompt,
    profile: config.profile,
    focus: config.focus,
    dryRun: config.dryRun
  });
  usage.addCall("planner", plannerResult.usage);
  if (plannerResult.parseFailed) {
    await events.log("planner_parse_failed", { error: plannerResult.parseError ?? "Planner response could not be parsed." });
    await events.log("planner_fallback_used");
  }
  for (const coercion of plannerResult.coercions ?? []) {
    await events.log("planner_focus_coerced", coercion);
  }
  const plannedTaskCount = plannerResult.plan.searchTasks.length;
  if (config.maxTasks && plannerResult.plan.searchTasks.length > config.maxTasks) {
    plannerResult.plan.searchTasks = plannerResult.plan.searchTasks.slice(0, config.maxTasks);
    await events.log("researcher_tasks_capped", { plannedTaskCount, maxTasks: config.maxTasks, taskCount: plannerResult.plan.searchTasks.length });
  }
  await events.log("planner_completed", { taskCount: plannerResult.plan.searchTasks.length, plannedTaskCount });
  await writeJsonArtifact(config.runDir, "plan.json", plannerResult.plan);
  await writeJsonArtifact(config.runDir, "queries.json", plannerResult.plan.searchTasks);

  const findings = await runResearchTasks({
    config,
    apiKey,
    tasks: plannerResult.plan.searchTasks,
    usage,
    events
  });

  let sources = dedupeSources(findings, config.focus);
  await logDedupedSources(events, findings, sources);
  let evidence = buildEvidence(findings, sources);
  await writeJsonArtifact(config.runDir, "sources.json", sources);
  await writeJsonArtifact(config.runDir, "evidence.json", evidence);

  await events.log("critic_started");
  let criticResult = await runCritic({
    apiKey,
    baseUrl: config.apiBaseUrl,
    model: config.roleModels.critic,
    maxCompletionTokens: config.maxOutputTokens.critic,
    plan: plannerResult.plan,
    evidence,
    sources,
    focus: config.focus,
    dryRun: config.dryRun
  });
  usage.addCall("critic", criticResult.usage);
  await logCriticParseFallback(events, criticResult);
  await events.log("critic_completed", {
    needsFollowUp: criticResult.critique.needsFollowUp,
    followUpCount: criticResult.critique.followUpTasks.length
  });

  const requestedFollowUpTasks = criticResult.critique.followUpTasks;
  const followUpTasks = requestedFollowUpTasks.filter((task) => task.depth <= config.profile.maxDepth);
  if (!config.dryRun && criticResult.critique.needsFollowUp && requestedFollowUpTasks.length > 0) {
    const remainingTaskBudget = typeof config.maxTasks === "number" ? Math.max(0, config.maxTasks - findings.length) : config.profile.initialSubquestions;
    if (remainingTaskBudget === 0) {
      await events.log("follow_up_skipped_task_cap_reached", {
        plannedFollowUpCount: requestedFollowUpTasks.length,
        maxTasks: config.maxTasks,
        completedTaskCount: findings.length
      });
    }
    const capped = followUpTasks.slice(0, Math.min(config.profile.initialSubquestions, remainingTaskBudget));
    if (capped.length === 0) {
      await events.log("researcher_tasks_capped", {
        plannedFollowUpCount: requestedFollowUpTasks.length,
        maxTasks: config.maxTasks,
        taskCount: findings.length
      });
    }
    if (capped.length > 0) {
      const gapFindings = await runResearchTasks({ config, apiKey, tasks: capped, usage, events });
      findings.push(...gapFindings);
      sources = dedupeSources(findings, config.focus);
      await logDedupedSources(events, findings, sources);
      evidence = buildEvidence(findings, sources);
      await writeJsonArtifact(config.runDir, "sources.json", sources);
      await writeJsonArtifact(config.runDir, "evidence.json", evidence);

      await events.log("critic_started", { pass: "after_gap_fill" });
      criticResult = await runCritic({
        apiKey,
        baseUrl: config.apiBaseUrl,
        model: config.roleModels.critic,
        maxCompletionTokens: config.maxOutputTokens.critic,
        plan: plannerResult.plan,
        evidence,
        sources,
        focus: config.focus,
        dryRun: config.dryRun
      });
      usage.addCall("critic", criticResult.usage);
      await logCriticParseFallback(events, criticResult);
      await events.log("critic_completed", { pass: "after_gap_fill" });
    }
  }

  await writeJsonArtifact(config.runDir, "critique.json", criticResult.critique);

  const failedTasks = findings.filter((finding) => finding.error).length;
  await events.log("writer_started", { sourceCount: sources.length, partial: failedTasks > 0 });
  const writerResult = await runWriter({
    apiKey,
    baseUrl: config.apiBaseUrl,
    model: config.roleModels.writer,
    maxCompletionTokens: config.maxOutputTokens.writer,
    plan: plannerResult.plan,
    evidence,
    critique: criticResult.critique,
    sources,
    partial: failedTasks > 0,
    dryRun: config.dryRun
  });
  usage.addCall("writer", writerResult.usage);
  await writeTextArtifact(config.runDir, "report.md", writerResult.report);
  await events.log("writer_completed", { bytes: Buffer.byteLength(writerResult.report, "utf8") });

  let reportReview: ReportReview | undefined;
  if (config.reviewReport) {
    reportReview = await runReportReviewStage({
      config,
      apiKey,
      events,
      usage,
      report: writerResult.report,
      plan: plannerResult.plan,
      evidence,
      critique: criticResult.critique,
      sources
    });
  }

  await events.log("citation_lint_started");
  const lint = lintCitations(writerResult.report, sources);
  if (!lint.ok) {
    await events.log("error", { phase: "citation_lint", unknownNumbers: lint.unknownNumbers });
    console.warn(`Citation lint warning: unknown citation numbers ${lint.unknownNumbers.join(", ")}`);
  }
  await events.log("citation_lint_completed", lint);

  const finalUsage = usage.finish(sources.length, lint.sourcesUsed);
  await writeJsonArtifact(config.runDir, "usage.json", finalUsage);
  await events.log("research_completed", {
    uniqueSources: sources.length,
    sourcesUsedInReport: lint.sourcesUsed,
    totalTokens: finalUsage.total_tokens
  });
  let summaryPath: string | undefined;
  try {
    const summary = await generateRunSummary(config.runDir);
    summaryPath = summary.path;
    await events.log("run_summary_written", { path: summary.path });
  } catch (error) {
    summaryPath = getRunSummaryPath(config.runDir);
    await events.log("run_summary_failed", { error: safeError(error), path: summaryPath }).catch(() => undefined);
  }

  completed = true;
  return {
    runId: config.runId,
    runDir: config.runDir,
    reportPath: path.join(config.runDir, "report.md"),
    focus: config.focus,
    searchProvider: config.searchProvider,
    researcherMode: config.researcherMode,
    usage: finalUsage,
    lintOk: lint.ok,
    lintUnknownNumbers: lint.unknownNumbers,
    reportReview,
    summaryPath
  };
  } finally {
    if (!completed) {
      await events.log("run_incomplete", { runId: config.runId }).catch(() => undefined);
    }
  }
}

async function runResearchTasks(params: {
  config: RunConfig;
  apiKey: string;
  tasks: SearchTask[];
  usage: UsageTracker;
  events: EventLogger;
}): Promise<Finding[]> {
  const findings: Finding[] = [];
  const searchProvider = createSearchProvider(params.config, params.apiKey);
  await runWithConcurrency(params.tasks, params.config.concurrency, async (task) => {
    await params.events.log("researcher_task_started", { taskId: task.id, query: task.query });
    if (params.config.searchProvider === "opencode-web") {
      await params.events.log("opencode_search_started", { taskId: task.id, query: task.query });
    }
    const finding = await runResearchTask({
      apiKey: params.apiKey,
      baseUrl: params.config.apiBaseUrl,
      model: params.config.roleModels.researcher,
      maxCompletionTokens: params.config.maxOutputTokens.researcher,
      profile: params.config.profile,
      task,
      searchProvider,
      opencodeTimeoutMs: params.config.opencodeTimeoutMs,
      opencodeRetries: params.config.opencodeRetries,
      researcherMode: params.config.researcherMode,
      dryRun: params.config.dryRun,
      onEvent: (type, metadata) => params.events.log(type, metadata)
    });
    if (finding.error) {
      params.usage.addError();
      await params.events.log("error", { phase: "researcher", taskId: task.id, error: finding.error });
      if (params.config.searchProvider === "opencode-web") {
        await params.events.log("opencode_search_failed", { taskId: task.id, error: finding.error });
      }
      if (isXiaomiNativeWebSearchDisabled(finding.error)) {
        await params.events.log("xiaomi_native_websearch_disabled", { taskId: task.id });
      }
    }
    if (finding.usage || (params.config.researcherMode === "extract" && (finding.extractionMode === "xiaomi" || finding.parseFailed))) {
      params.usage.addCall("researcher", finding.usage);
    }
    if (finding.providerResult?.provider === "opencode-web") {
      params.usage.addOpenCodeUsage(finding.providerResult.usage);
      for (const warning of finding.providerResult.warnings ?? []) {
        await params.events.log("opencode_event_parse_warning", { taskId: task.id, warning });
      }
      await params.events.log("opencode_search_completed", {
        taskId: task.id,
        sources: finding.providerResult.sources.length,
        rawEventsCount: finding.providerResult.rawEventsCount
      });
      if (finding.providerResult.sourcesExtracted) {
        await params.events.log("opencode_search_sources_extracted", { taskId: task.id, sources: finding.providerResult.sources.length });
      }
      if (finding.providerResult.earlyExit) {
        await params.events.log("opencode_search_early_exit", { taskId: task.id });
      }
    }
    params.usage.addRawSources(finding.annotations.length);
    await writeFinding(params.config.runDir, task.id, finding);
    for (const annotation of finding.annotations) {
      await params.events.log("source_added", { taskId: task.id, canonicalUrl: annotation.canonicalUrl });
    }
    await params.events.log("researcher_task_completed", {
      taskId: task.id,
      annotations: finding.annotations.length,
      claims: finding.claims.length,
      failed: Boolean(finding.error)
    });
    findings.push(finding);
  });
  return findings.sort((a, b) => a.taskId.localeCompare(b.taskId));
}

async function runReportReviewStage(params: {
  config: RunConfig;
  apiKey: string;
  events: EventLogger;
  usage: UsageTracker;
  report: string;
  plan: Plan;
  evidence: EvidenceFile;
  critique: Critique;
  sources: Source[];
}): Promise<ReportReview> {
  await params.events.log("report_review_started");
  try {
    const reviewResult = await runReportReviewer({
      apiKey: params.apiKey,
      baseUrl: params.config.apiBaseUrl,
      model: params.config.roleModels.reportReviewer,
      maxCompletionTokens: params.config.maxOutputTokens.reportReviewer,
      report: params.report,
      plan: params.plan,
      evidence: params.evidence,
      critique: params.critique,
      sources: params.sources,
      dryRun: params.config.dryRun
    });
    params.usage.addCall("reportReviewer", reviewResult.usage);
    if (reviewResult.parseFailed) {
      await params.events.log("report_review_failed", { error: reviewResult.parseError ?? "Report reviewer response could not be parsed." });
      await params.events.log("report_review_fallback_used");
    }
    await writeJsonArtifact(params.config.runDir, "report_review.json", reviewResult.review);
    await writeTextArtifact(params.config.runDir, "report_review.md", renderReportReviewMarkdown(reviewResult.review));
    await params.events.log("report_review_completed", {
      readyForUse: reviewResult.review.readyForUse,
      qualityScore: reviewResult.review.qualityScore
    });
    return reviewResult.review;
  } catch (error) {
    const reason = safeError(error);
    const review: ReportReview = {
      overallAssessment: `Report reviewer failed: ${reason}`,
      qualityScore: 0,
      citationAssessment: {
        hasUnsupportedClaims: false,
        unsupportedClaims: [],
        citationCoverage: "Report reviewer failed; rely on citation_linter output."
      },
      sourceQuality: {
        strongSources: [],
        weakSources: [],
        marketingHeavy: false,
        notes: "Source quality was not reviewed because the reviewer failed."
      },
      gaps: [],
      recommendations: ["Review report artifacts manually."],
      readyForUse: false
    };
    await params.events.log("report_review_failed", { error: reason });
    await params.events.log("report_review_fallback_used");
    await writeJsonArtifact(params.config.runDir, "report_review.json", review);
    await writeTextArtifact(params.config.runDir, "report_review.md", renderReportReviewMarkdown(review));
    return review;
  }
}

function createSearchProvider(config: RunConfig, apiKey: string): SearchProvider {
  if (config.searchProvider === "xiaomi-native") {
    return new XiaomiNativeWebSearchProvider({ apiKey, baseUrl: config.apiBaseUrl });
  }
  return new OpenCodeWebSearchProvider(config.opencodeModel);
}

function buildEvidence(findings: Finding[], sources: Source[]): EvidenceFile {
  const sourceIdByUrl = sourceIdByCanonicalUrl(sources);
  const citationById = citationIndexBySourceId(sources);
  const claims: EvidenceClaim[] = [];
  let rawAnnotationCount = 0;
  for (const finding of findings) {
    rawAnnotationCount += finding.annotations.length;
    for (const claim of finding.claims) {
      const mappedSourceIds = claim.sourceIds
        .map((canonicalUrl) => sourceIdByUrl.get(canonicalUrl))
        .filter((id): id is string => Boolean(id));
      const deduped = [...new Set(mappedSourceIds)].sort((a, b) => (citationById.get(a) ?? 0) - (citationById.get(b) ?? 0));
      claims.push({
        ...claim,
        sourceIds: deduped
      });
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    claims,
    sourceCount: sources.length,
    rawAnnotationCount
  };
}

async function logDedupedSources(events: EventLogger, findings: Finding[], sources: Source[]): Promise<void> {
  const raw = findings.reduce((sum, finding) => sum + finding.annotations.length, 0);
  const deduplicated = Math.max(0, raw - sources.length);
  if (deduplicated > 0) {
    await events.log("source_deduplicated", { rawSources: raw, uniqueSources: sources.length, deduplicated });
  }
}

async function logCriticParseFallback(
  events: EventLogger,
  criticResult: { parseFailed?: boolean; parseError?: string }
): Promise<void> {
  if (!criticResult.parseFailed) {
    return;
  }
  await events.log("critic_parse_failed", { error: criticResult.parseError ?? "Critic response could not be parsed." });
  await events.log("critic_fallback_used");
}

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      if (item !== undefined) {
        await worker(item);
      }
    }
  });
  await Promise.all(workers);
}

function sanitizeConfig(config: RunConfig): Omit<RunConfig, "prompt"> {
  const { prompt: _prompt, ...rest } = config;
  return rest;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 240);
}
