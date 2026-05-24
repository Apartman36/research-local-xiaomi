import path from "node:path";
import { lintCitations } from "./evidence/citation-linter.js";
import { dedupeSources } from "./evidence/dedupe-sources.js";
import { citationIndexBySourceId, sourceIdByCanonicalUrl } from "./evidence/source-ids.js";
import { runCritic } from "./agents/critic.js";
import { runPlanner } from "./agents/planner.js";
import { runResearchTask } from "./agents/researcher.js";
import { runWriter } from "./agents/writer.js";
import { EventLogger } from "./store/events.js";
import { createRunDirectory, writeFinding, writeJsonArtifact, writeTextArtifact } from "./store/run-store.js";
import { UsageTracker } from "./store/usage.js";
import type { EvidenceClaim, EvidenceFile, Finding, RunConfig, SearchTask, Source, UsageSummary } from "./types.js";

export type RunResult = {
  runId: string;
  runDir: string;
  reportPath: string;
  focus: string;
  usage: UsageSummary;
  lintOk: boolean;
};

export async function runResearch(config: RunConfig, apiKey: string): Promise<RunResult> {
  await createRunDirectory(config.runDir);
  const events = new EventLogger(path.join(config.runDir, "events.jsonl"), config.verbose);
  const usage = new UsageTracker(config.startedAt, config.profile.name, config.model);

  await events.log("research_started", {
    runId: config.runId,
    profile: config.profile.name,
    focus: config.focus,
    model: config.model,
    dryRun: config.dryRun
  });
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
  await events.log("planner_completed", { taskCount: plannerResult.plan.searchTasks.length });
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
  await events.log("critic_completed", {
    needsFollowUp: criticResult.critique.needsFollowUp,
    followUpCount: criticResult.critique.followUpTasks.length
  });

  const followUpTasks = criticResult.critique.followUpTasks.filter((task) => task.depth <= config.profile.maxDepth);
  if (!config.dryRun && criticResult.critique.needsFollowUp && followUpTasks.length > 0) {
    const capped = followUpTasks.slice(0, config.profile.initialSubquestions);
    const gapFindings = await runResearchTasks({ config, apiKey, tasks: capped, usage, events });
    findings.push(...gapFindings);
    sources = dedupeSources(findings, config.focus);
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
    await events.log("critic_completed", { pass: "after_gap_fill" });
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

  return {
    runId: config.runId,
    runDir: config.runDir,
    reportPath: path.join(config.runDir, "report.md"),
    focus: config.focus,
    usage: finalUsage,
    lintOk: lint.ok
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
  await runWithConcurrency(params.tasks, params.config.concurrency, async (task) => {
    await params.events.log("researcher_task_started", { taskId: task.id, query: task.query });
    const finding = await runResearchTask({
      apiKey: params.apiKey,
      baseUrl: params.config.apiBaseUrl,
      model: params.config.roleModels.researcher,
      maxCompletionTokens: params.config.maxOutputTokens.researcher,
      profile: params.config.profile,
      task,
      dryRun: params.config.dryRun
    });
    if (finding.error) {
      params.usage.addError();
      await params.events.log("error", { phase: "researcher", taskId: task.id, error: finding.error });
    }
    params.usage.addCall("researcher", finding.usage);
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
