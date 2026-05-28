import path from "node:path";
import { access, readFile } from "node:fs/promises";
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
import { readRunState, RunStateTracker } from "./store/run-state.js";
import { createRunDirectory, writeFinding, writeJsonArtifact, writeTextArtifact } from "./store/run-store.js";
import { UsageTracker } from "./store/usage.js";
import type { CitationLintResult, Critique, EvidenceClaim, EvidenceFile, Finding, Plan, ReportReview, RunConfig, RunStage, SearchTask, Source, UsageSummary } from "./types.js";

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
  const usage = new UsageTracker(config.startedAt, config.profile.name, config.model, config.quotaMode);
  const state = await RunStateTracker.create(config);
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

    await state.start("planner");
    await events.log("planner_started");
    const plannerResult = await runPlanner({
      apiKey,
      baseUrl: config.apiBaseUrl,
      model: config.roleModels.planner,
      maxCompletionTokens: config.maxOutputTokens.planner,
      timeoutMs: config.xiaomiTimeoutMs,
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
    await state.complete("planner");

    await state.start("search");
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

    await state.start("critic");
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
      dryRun: config.dryRun,
      timeoutMs: config.xiaomiTimeoutMs
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
        await state.start("researcher");
        const gapFindings = await runResearchTasks({ config, apiKey, tasks: capped, usage, events });
        findings.push(...gapFindings);
        sources = dedupeSources(findings, config.focus);
        await logDedupedSources(events, findings, sources);
        evidence = buildEvidence(findings, sources);
        await writeJsonArtifact(config.runDir, "sources.json", sources);
        await writeJsonArtifact(config.runDir, "evidence.json", evidence);

        await state.start("critic");
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
          dryRun: config.dryRun,
          timeoutMs: config.xiaomiTimeoutMs
        });
        usage.addCall("critic", criticResult.usage);
        await logCriticParseFallback(events, criticResult);
        await events.log("critic_completed", { pass: "after_gap_fill" });
      }
    }
    await state.complete("search");
    await state.complete("researcher");

    await writeJsonArtifact(config.runDir, "critique.json", criticResult.critique);
    await state.complete("critic");

    const result = await runFinalStages({
      config,
      apiKey,
      events,
      usage,
      state,
      plan: plannerResult.plan,
      evidence,
      critique: criticResult.critique,
      sources,
      startStage: "writer",
      partial: findings.some((finding) => finding.error)
    });

    completed = true;
    return result;
  } catch (error) {
    await state.fail(safeError(error)).catch(() => undefined);
    throw error;
  } finally {
    if (!completed) {
      await events.log("run_incomplete", { runId: config.runId }).catch(() => undefined);
    }
  }
}

export type ResumeOptions = {
  notify?: boolean;
  verbose?: boolean;
  xiaomiTimeoutMs?: number;
  writerTimeoutMs?: number;
  reviewReport?: boolean;
};

export async function resumeResearch(runDir: string, apiKey: string, options: ResumeOptions = {}): Promise<RunResult> {
  const config = await loadResumableConfig(runDir, options);
  const snapshot = await readRunState(config.runDir);
  if (!snapshot) {
    throw new Error(
      `Cannot resume run ${config.runId} because state.json is missing. This run may have been created before resume support. Resume is read-only for legacy runs unless state is explicitly imported in a future command.`
    );
  }
  if (snapshot.status === "completed" || snapshot.currentStage === "completed") {
    throw new Error(`Run ${config.runId} is already completed. Nothing to resume.`);
  }
  const failedStage = snapshot.failedStage ?? snapshot.currentStage;
  const startStage = normalizeResumeStage(failedStage);
  await createRunDirectory(config.runDir);
  const events = new EventLogger(path.join(config.runDir, "events.jsonl"), config.verbose);
  const state = await RunStateTracker.load(config.runDir);
  const usage = new UsageTracker(new Date().toISOString(), config.profile.name, config.model, config.quotaMode);

  await events.log("resume_started", { runId: config.runId, failedStage });
  await events.log("resume_stage_selected", { stage: startStage });
  try {
    const artifacts = await loadResumeArtifacts(config.runDir, startStage, events);
    const result = await runFinalStages({
      config,
      apiKey,
      events,
      usage,
      state,
      plan: artifacts.plan,
      evidence: artifacts.evidence,
      critique: artifacts.critique,
      sources: artifacts.sources,
      report: artifacts.report,
      startStage,
      partial: false
    });
    await events.log("resume_completed", { runId: config.runId, stage: startStage });
    return result;
  } catch (error) {
    await state.fail(safeError(error), startStage).catch(() => undefined);
    await events.log("resume_failed", { runId: config.runId, stage: startStage, error: safeError(error) }).catch(() => undefined);
    throw error;
  }
}

async function runFinalStages(params: {
  config: RunConfig;
  apiKey: string;
  events: EventLogger;
  usage: UsageTracker;
  state: RunStateTracker;
  plan: Plan;
  evidence: EvidenceFile;
  critique: Critique;
  sources: Source[];
  report?: string;
  startStage: ResumableStage;
  partial: boolean;
}): Promise<RunResult> {
  const startIndex = RESUME_STAGE_ORDER.indexOf(params.startStage);
  let report = params.report;
  let reportReview: ReportReview | undefined;

  if (startIndex <= RESUME_STAGE_ORDER.indexOf("writer")) {
    await params.state.start("writer");
    await params.events.log("writer_started", { sourceCount: params.sources.length, partial: params.partial });
    const writerResult = await runWriter({
      apiKey: params.apiKey,
      baseUrl: params.config.apiBaseUrl,
      model: params.config.roleModels.writer,
      maxCompletionTokens: params.config.maxOutputTokens.writer,
      plan: params.plan,
      evidence: params.evidence,
      critique: params.critique,
      sources: params.sources,
      partial: params.partial,
      dryRun: params.config.dryRun,
      timeoutMs: params.config.writerTimeoutMs ?? params.config.xiaomiTimeoutMs
    });
    params.usage.addCall("writer", writerResult.usage);
    report = writerResult.report;
    await writeTextArtifact(params.config.runDir, "report.md", report);
    await params.events.log("writer_completed", { bytes: Buffer.byteLength(report, "utf8") });
    await params.state.complete("writer");
  }

  if (!report) {
    throw new Error("Cannot continue without report.md.");
  }

  if (startIndex <= RESUME_STAGE_ORDER.indexOf("reportReviewer")) {
    await params.state.start("reportReviewer");
    if (params.config.reviewReport) {
      reportReview = await runReportReviewStage({
        config: params.config,
        apiKey: params.apiKey,
        events: params.events,
        usage: params.usage,
        report,
        plan: params.plan,
        evidence: params.evidence,
        critique: params.critique,
        sources: params.sources
      });
    }
    await params.state.complete("reportReviewer");
  } else {
    reportReview = await readOptionalJson<ReportReview>(path.join(params.config.runDir, "report_review.json"));
  }

  await params.state.start("citationLint");
  let lint: CitationLintResult;
  if (startIndex <= RESUME_STAGE_ORDER.indexOf("citationLint")) {
    await params.events.log("citation_lint_started");
    lint = lintCitations(report, params.sources);
    await writeJsonArtifact(params.config.runDir, "citation_lint.json", lint);
    if (!lint.ok) {
      await params.events.log("error", { phase: "citation_lint", unknownNumbers: lint.unknownNumbers });
      console.warn(`Citation lint warning: unknown citation numbers ${lint.unknownNumbers.join(", ")}`);
    }
    await params.events.log("citation_lint_completed", lint);
  } else {
    lint = (await readOptionalJson<CitationLintResult>(path.join(params.config.runDir, "citation_lint.json"))) ?? lintCitations(report, params.sources);
  }
  await params.state.complete("citationLint");

  const finalUsage = params.usage.finish(params.sources.length, lint.sourcesUsed);
  await writeJsonArtifact(params.config.runDir, "usage.json", finalUsage);
  await params.events.log("research_completed", {
    uniqueSources: params.sources.length,
    sourcesUsedInReport: lint.sourcesUsed,
    totalTokens: finalUsage.total_tokens
  });

  await params.state.start("summary");
  let summaryPath: string | undefined;
  try {
    const summary = await generateRunSummary(params.config.runDir);
    summaryPath = summary.path;
    await params.events.log("run_summary_written", { path: summary.path });
    await params.state.complete("summary");
  } catch (error) {
    summaryPath = getRunSummaryPath(params.config.runDir);
    await params.events.log("run_summary_failed", { error: safeError(error), path: summaryPath }).catch(() => undefined);
    throw error;
  }
  await params.state.completed();

  return {
    runId: params.config.runId,
    runDir: params.config.runDir,
    reportPath: path.join(params.config.runDir, "report.md"),
    focus: params.config.focus,
    searchProvider: params.config.searchProvider,
    researcherMode: params.config.researcherMode,
    usage: finalUsage,
    lintOk: lint.ok,
    lintUnknownNumbers: lint.unknownNumbers,
    reportReview,
    summaryPath
  };
}

const RESUME_STAGE_ORDER = ["writer", "reportReviewer", "citationLint", "summary"] as const;
type ResumableStage = (typeof RESUME_STAGE_ORDER)[number];

function normalizeResumeStage(stage: RunStage): ResumableStage {
  if (RESUME_STAGE_ORDER.includes(stage as ResumableStage)) {
    return stage as ResumableStage;
  }
  throw new Error(`Cannot resume from stage ${stage}. Supported stages: ${RESUME_STAGE_ORDER.join(", ")}.`);
}

async function loadResumeArtifacts(runDir: string, stage: ResumableStage, events: EventLogger): Promise<{
  plan: Plan;
  sources: Source[];
  evidence: EvidenceFile;
  critique: Critique;
  report?: string;
}> {
  const requiredByStage: Record<ResumableStage, string[]> = {
    writer: ["plan.json", "sources.json", "evidence.json", "critique.json"],
    reportReviewer: ["plan.json", "sources.json", "evidence.json", "critique.json", "report.md"],
    citationLint: ["sources.json", "report.md"],
    summary: []
  };
  const missing: string[] = [];
  for (const artifact of requiredByStage[stage]) {
    if (!(await fileExists(path.join(runDir, artifact)))) {
      missing.push(artifact);
    }
  }
  if (missing.length > 0) {
    throw new Error(`Cannot resume from stage ${stage} because required artifacts are missing: ${missing.join(", ")}`);
  }

  const plan = (await readRequiredJson<Plan>(path.join(runDir, "plan.json"), stage)) ?? emptyPlan();
  const sources = (await readRequiredJson<Source[]>(path.join(runDir, "sources.json"), stage)) ?? [];
  const evidence = (await readRequiredJson<EvidenceFile>(path.join(runDir, "evidence.json"), stage)) ?? emptyEvidence(sources);
  const critique = (await readRequiredJson<Critique>(path.join(runDir, "critique.json"), stage)) ?? emptyCritique();
  const report = await readOptionalText(path.join(runDir, "report.md"));
  for (const artifact of ["plan.json", "sources.json", "evidence.json", "critique.json", "report.md"]) {
    if (await fileExists(path.join(runDir, artifact))) {
      await events.log("resume_artifact_loaded", { artifact });
    }
  }
  return { plan, sources, evidence, critique, report };
}

async function loadResumableConfig(runDir: string, options: ResumeOptions): Promise<RunConfig> {
  const persisted = await readRequiredJson<Omit<RunConfig, "prompt">>(path.join(runDir, "config.json"), "writer");
  if (!persisted) {
    throw new Error("Cannot resume because config.json is missing.");
  }
  const prompt = (await readOptionalText(path.join(runDir, "input.md"))) ?? "";
  return {
    ...persisted,
    prompt,
    runDir,
    outputDirRoot: path.dirname(runDir),
    quotaMode: persisted.quotaMode ?? "normal",
    notify: options.notify ?? persisted.notify,
    verbose: options.verbose ?? persisted.verbose,
    xiaomiTimeoutMs: options.xiaomiTimeoutMs ?? persisted.xiaomiTimeoutMs,
    writerTimeoutMs: options.writerTimeoutMs ?? persisted.writerTimeoutMs,
    reviewReport: options.reviewReport ?? persisted.reviewReport
  };
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
      xiaomiTimeoutMs: params.config.xiaomiTimeoutMs,
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
      dryRun: params.config.dryRun,
      timeoutMs: params.config.xiaomiTimeoutMs
    });
    params.usage.addCall("reportReviewer", reviewResult.usage);
    if (reviewResult.parseFailed) {
      await params.events.log("report_review_failed", { error: reviewResult.parseError ?? "Report reviewer response could not be parsed." });
      await params.events.log("report_review_fallback_used");
      if (reviewResult.rawContent) {
        await writeTextArtifact(params.config.runDir, "report_review_raw.txt", reviewResult.rawContent);
        reviewResult.review.rawOutputPath = "./report_review_raw.txt";
      }
    }
    await writeJsonArtifact(params.config.runDir, "report_review.json", reviewResult.review);
    await writeTextArtifact(params.config.runDir, "report_review.md", renderReportReviewMarkdown(reviewResult.review));
    await params.events.log("report_review_completed", {
      readyForUse: reviewResult.review.readyForUse,
      readinessScore: reviewResult.review.readinessScore,
      scoreLabel: reviewResult.review.scoreLabel,
      qualityScore: reviewResult.review.qualityScore
    });
    return reviewResult.review;
  } catch (error) {
    const reason = safeError(error);
    const review: ReportReview = {
      overallAssessment: `Report reviewer failed: ${reason}`,
      readinessScore: -1,
      scoreLabel: "weak",
      topGaps: ["Report reviewer failed."],
      topRecommendations: ["Review report artifacts manually."],
      sourceQualityNotes: ["Source quality was not reviewed because the reviewer failed."],
      followUpQueries: [],
      parseFallback: true,
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
      gaps: [{ gap: "Report reviewer failed.", whyItMatters: "QA artifacts are incomplete." }],
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

async function readRequiredJson<T>(filePath: string, _stage: ResumableStage): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
  }
}

async function readOptionalJson<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }
    throw error;
  }
}

function emptyPlan(): Plan {
  return { topic: "Resumed run", objective: "Resume available artifacts.", assumptions: [], subquestions: [], searchTasks: [] };
}

function emptyEvidence(sources: Source[]): EvidenceFile {
  return { generatedAt: new Date().toISOString(), claims: [], sourceCount: sources.length, rawAnnotationCount: 0 };
}

function emptyCritique(): Critique {
  return {
    summary: "Resume did not require critique artifacts.",
    weakAreas: [],
    missingCoverage: [],
    duplicateEvidence: [],
    followUpTasks: [],
    needsFollowUp: false
  };
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 240);
}
