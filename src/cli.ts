#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { Command } from "commander";
import { buildRunConfig, DEFAULT_BASE_URL, DEFAULT_MODEL, requireApiKey } from "./config.js";
import { lintCitations } from "./evidence/citation-linter.js";
import { writeFollowUpPrompt } from "./follow-up/generate-follow-up-prompt.js";
import { chat, chatWithWebSearch, extractAnnotations, extractUsage } from "./providers/xiaomi.js";
import { resumeResearch, runResearch, type ResumeOptions, type RunResult } from "./orchestrator.js";
import { generateRunSummary, getRunSummaryPath, listRunArtifacts } from "./store/run-summary.js";
import { listRuns, resolveRun } from "./store/run-store.js";
import type { RunConfig, Source } from "./types.js";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("research-xm")
    .description("Local research orchestration CLI powered by Xiaomi MiMo Web Search.")
    .version("0.1.0")
    .addHelpText("after", "\nRun option: --search-provider <opencode-web|xiaomi-native> defaults to opencode-web.");

  program
  .command("run")
  .description("Run a local research workflow.")
  .argument("[prompt]", "short inline research prompt")
  .option("-f, --file <path>", "read a long research prompt from a Markdown/text file")
  .option("--profile <smoke5|normal100|deep500>", "research profile", "normal100")
  .option("--model <model>", "model for all roles", DEFAULT_MODEL)
  .option("--focus <web|github>", "research focus mode", "web")
  .option("--search-provider <opencode-web|xiaomi-native>", "search provider", "opencode-web")
  .option("--researcher-mode <extract|mechanical>", "researcher extraction mode", "extract")
  .option("--review-report", "write report_review.json and report_review.md QA artifacts", true)
  .option("--no-review-report", "skip report review QA artifacts")
  .option("--output-dir <path>", "run output root directory", "./runs")
  .option("--max-output-tokens <number>", "writer max completion tokens; other roles are capped by their defaults")
  .option("--max-tasks <n>", "cap researcher tasks after planning")
  .option("--quota-mode <conservative|normal|aggressive>", "quota warning profile", "normal")
  .option("--opencode-timeout-ms <ms>", "OpenCode subprocess timeout in milliseconds", "180000")
  .option("--opencode-retries <n>", "OpenCode transient failure retries, from 0 to 5", "2")
  .option("--xiaomi-timeout-ms <ms>", "Xiaomi role call timeout in milliseconds", "120000")
  .option("--writer-timeout-ms <ms>", "writer Xiaomi call timeout in milliseconds")
  .option("--concurrency <number>", "max concurrent researcher calls", "3")
  .option("--notify", "play a completion or failure sound")
  .option("--dry-run", "create artifacts without calling Xiaomi")
  .option("--verbose", "print debug event metadata")
  .action(async (prompt: string | undefined, options: Record<string, unknown>) => {
    let config: RunConfig | undefined;
    try {
      config = await buildRunConfig({
        file: options.file as string | undefined,
        inlinePrompt: prompt,
        profile: options.profile as "smoke5" | "normal100" | "deep500" | undefined,
        model: options.model as string | undefined,
        focus: options.focus as "web" | "github" | undefined,
        searchProvider: options.searchProvider as "opencode-web" | "xiaomi-native" | undefined,
        researcherMode: options.researcherMode as "extract" | "mechanical" | undefined,
        reviewReport: options.reviewReport as boolean | undefined,
        outputDir: options.outputDir as string | undefined,
        maxOutputTokens: options.maxOutputTokens as string | undefined,
        maxTasks: options.maxTasks as string | undefined,
        quotaMode: options.quotaMode as "conservative" | "normal" | "aggressive" | undefined,
        opencodeTimeoutMs: options.opencodeTimeoutMs as string | undefined,
        opencodeRetries: options.opencodeRetries as string | undefined,
        xiaomiTimeoutMs: options.xiaomiTimeoutMs as string | undefined,
        writerTimeoutMs: options.writerTimeoutMs as string | undefined,
        concurrency: options.concurrency as string | undefined,
        notify: Boolean(options.notify),
        dryRun: Boolean(options.dryRun),
        verbose: Boolean(options.verbose)
      });
      printQuotaStartupWarnings(config);
      const apiKey = config.dryRun ? "dry-run" : requireApiKey();
      const result = await runResearch(config, apiKey);
      printRunSummary(result);
      if (config.notify) {
        await playNotification(true);
      }
    } catch (error) {
      if (config?.notify) {
        await playNotification(false);
      }
      exitWithError(error);
    }
  });

  program
  .command("list")
  .description("List local research runs.")
  .option("--output-dir <path>", "run output root directory", "./runs")
  .action(async (options: { outputDir: string }) => {
    try {
      const runs = await listRuns(path.resolve(options.outputDir));
      if (runs.length === 0) {
        console.log("No runs found.");
        return;
      }
      for (const run of runs) {
        console.log(run);
      }
    } catch (error) {
      exitWithError(error);
    }
  });

  program
  .command("show")
  .description("Show a run summary.")
  .argument("<run>", "run id or latest")
  .option("--output-dir <path>", "run output root directory", "./runs")
  .action(async (run: string, options: { outputDir: string }) => {
    try {
      const runDir = await resolveRun(path.resolve(options.outputDir), run);
      console.log(`Run: ${path.basename(runDir)}`);
      console.log(`Directory: ${runDir}`);
      console.log(`Report: ${path.join(runDir, "report.md")}`);
      let usage: any;
      try {
        usage = await readJson(path.join(runDir, "usage.json"));
      } catch (error) {
        if (isMissingFileError(error)) {
          console.log("Run is incomplete: usage.json not found.");
          console.log(`Existing files: ${(await listRunArtifacts(runDir)).join(", ") || "(none)"}`);
          return;
        }
        throw error;
      }
      console.log(`Profile: ${usage.profile}`);
      console.log(`Model: ${usage.model}`);
      console.log(`Unique sources: ${usage.uniqueSources}`);
      console.log(`Total tokens: ${usage.total_tokens}`);
    } catch (error) {
      exitWithError(error);
    }
  });

  program
  .command("validate")
  .description("Validate report citations for a run.")
  .argument("<run>", "run id or latest")
  .option("--output-dir <path>", "run output root directory", "./runs")
  .action(async (run: string, options: { outputDir: string }) => {
    try {
      const runDir = await resolveRun(path.resolve(options.outputDir), run);
      let report: string;
      try {
        report = await readFile(path.join(runDir, "report.md"), "utf8");
      } catch (error) {
        if (isMissingFileError(error)) {
          console.log("Run is incomplete: report.md not found.");
          return;
        }
        throw error;
      }
      const sources = (await readJson(path.join(runDir, "sources.json"))) as Source[];
      const lint = lintCitations(report, sources);
      console.log(`Citation lint: ${lint.ok ? "ok" : "failed"}`);
      console.log(`Cited sources: ${lint.sourcesUsed}`);
      if (!lint.ok) {
        console.log(`Unknown citation numbers: ${lint.unknownNumbers.join(", ")}`);
        process.exitCode = 1;
      }
    } catch (error) {
      exitWithError(error);
    }
  });

  program
    .command("summary")
    .description("Print or generate the human-friendly run summary.")
    .argument("<run>", "run id or latest")
    .option("--output-dir <path>", "run output root directory", "./runs")
    .option("--path", "print only the run_summary.md path")
    .action(async (run: string, options: { outputDir: string; path?: boolean }) => {
      try {
        process.stdout.write(await printSummaryCommand(run, { outputDir: options.outputDir, pathOnly: Boolean(options.path) }));
      } catch (error) {
        exitWithError(error);
      }
    });

  program
    .command("follow-up")
    .description("Generate or execute a focused follow-up prompt for a run.")
    .argument("<run>", "run id or latest")
    .option("--write-prompt-only", "write follow_up_prompt.md without starting a new run")
    .option("--execute", "execute a new child run from follow_up_prompt.md")
    .option("--output-dir <path>", "run output root directory", "./runs")
    .option("--profile <smoke5|normal100|deep500>", "research profile", "normal100")
    .option("--model <model>", "model for all roles", DEFAULT_MODEL)
    .option("--focus <web|github>", "research focus mode", "web")
    .option("--search-provider <opencode-web|xiaomi-native>", "search provider", "opencode-web")
    .option("--researcher-mode <extract|mechanical>", "researcher extraction mode", "extract")
    .option("--review-report", "write report_review.json and report_review.md QA artifacts", true)
    .option("--no-review-report", "skip report review QA artifacts")
    .option("--max-output-tokens <number>", "writer max completion tokens; other roles are capped by their defaults")
    .option("--max-tasks <n>", "cap researcher tasks after planning")
    .option("--quota-mode <conservative|normal|aggressive>", "quota warning profile", "normal")
    .option("--opencode-timeout-ms <ms>", "OpenCode subprocess timeout in milliseconds", "180000")
    .option("--opencode-retries <n>", "OpenCode transient failure retries, from 0 to 5", "2")
    .option("--xiaomi-timeout-ms <ms>", "Xiaomi role call timeout in milliseconds", "120000")
    .option("--writer-timeout-ms <ms>", "writer Xiaomi call timeout in milliseconds")
    .option("--concurrency <number>", "max concurrent researcher calls", "3")
    .option("--notify", "play a completion or failure sound")
    .option("--verbose", "print debug event metadata")
    .action(async (run: string, options: FollowUpCommandOptions) => {
      try {
        process.stdout.write(await printFollowUpCommand(run, options));
      } catch (error) {
        exitWithError(error);
      }
    });

  program
    .command("resume")
    .description("Resume a failed run from writer, report reviewer, citation lint, or summary stages.")
    .argument("<run>", "run id or latest")
    .option("--output-dir <path>", "run output root directory", "./runs")
    .option("--review-report", "run report review QA artifacts when resuming", true)
    .option("--no-review-report", "skip report review QA artifacts when resuming")
    .option("--xiaomi-timeout-ms <ms>", "Xiaomi role call timeout in milliseconds")
    .option("--writer-timeout-ms <ms>", "writer Xiaomi call timeout in milliseconds")
    .option("--notify", "play a completion or failure sound")
    .option("--verbose", "print debug event metadata")
    .action(async (run: string, options: ResumeCommandOptions) => {
      try {
        process.stdout.write(await printResumeCommand(run, options));
        if (options.notify) {
          await playNotification(true);
        }
      } catch (error) {
        if (options.notify) {
          await playNotification(false);
        }
        exitWithError(error);
      }
    });

  program
    .command("smoke")
  .description("Run a real Xiaomi API smoke test. Uses basic chat unless --web is passed.")
  .option("--web", "include Xiaomi Web Search")
  .option("--model <model>", "model to test", DEFAULT_MODEL)
  .option("--base-url <url>", "Xiaomi API base URL", process.env.XIAOMI_MIMO_BASE_URL ?? DEFAULT_BASE_URL)
  .action(async (options: { web?: boolean; model: string; baseUrl: string }) => {
    try {
      const apiKey = requireApiKey();
      if (options.web) {
        const response = await chatWithWebSearch({
          apiKey,
          baseUrl: options.baseUrl,
          model: options.model,
          maxCompletionTokens: 1000,
          maxKeyword: 3,
          limit: 3,
          messages: [{ role: "user", content: "Find current official information about Xiaomi MiMo model web search. Reply briefly." }]
        });
        const usage = extractUsage(response);
        console.log("Smoke status: ok");
        console.log(`Model: ${response.model ?? options.model}`);
        console.log(`Annotations: ${extractAnnotations(response).length}`);
        console.log(`Usage: ${JSON.stringify(usage ?? {}, null, 2)}`);
      } else {
        const response = await chat({
          apiKey,
          baseUrl: options.baseUrl,
          model: options.model,
          maxCompletionTokens: 100,
          messages: [{ role: "user", content: "Reply in one short sentence. Say hello and name your model." }]
        });
        console.log("Smoke status: ok");
        console.log(`Model: ${response.model ?? options.model}`);
        console.log(`Reply: ${response.choices?.[0]?.message?.content ?? ""}`);
        console.log(`Usage: ${JSON.stringify(extractUsage(response) ?? {}, null, 2)}`);
      }
    } catch (error) {
      exitWithError(error);
    }
  });

  return program;
}

export async function printSummaryCommand(
  run: string,
  options: { outputDir: string; pathOnly?: boolean }
): Promise<string> {
  const runDir = await resolveRun(path.resolve(options.outputDir), run);
  const summaryPath = getRunSummaryPath(runDir);
  if (options.pathOnly) {
    if (!(await fileExists(summaryPath))) {
      await generateRunSummary(runDir);
    }
    return `${summaryPath}\n`;
  }
  if (await fileExists(summaryPath)) {
    return readFile(summaryPath, "utf8");
  }
  const summary = await generateRunSummary(runDir);
  if (summary.missingArtifacts.includes("usage.json")) {
    const files = await listRunArtifacts(runDir);
    const existing = files.length > 0 ? files.join(", ") : "(none)";
    return `${summary.markdown}\nRun is incomplete: usage.json not found.\nExisting files: ${existing}\n`;
  }
  return summary.markdown;
}

export async function printFollowUpCommand(
  run: string,
  options: FollowUpCommandOptions,
  deps: FollowUpCommandDeps = {}
): Promise<string> {
  const writePromptOnly = Boolean(options.writePromptOnly);
  const execute = Boolean(options.execute);
  if (writePromptOnly === execute) {
    throw new Error("Exactly one of --write-prompt-only or --execute is required.");
  }
  const runDir = await resolveRun(path.resolve(options.outputDir), run);
  const result = await writeFollowUpPrompt(runDir);
  if (writePromptOnly) {
    return `Follow-up prompt written: ${result.path}\n`;
  }
  const parentConfig = await readOptionalJson(path.join(runDir, "config.json"));
  const parentDepth = typeof parentConfig?.followUpDepth === "number" ? parentConfig.followUpDepth : 0;
  if (parentDepth >= 1) {
    const runId = path.basename(runDir);
    const prefix = run === "latest" ? `Latest run ${runId}` : `Run ${runId}`;
    const parentRunId = typeof parentConfig?.parentRunId === "string" && parentConfig.parentRunId.trim() ? parentConfig.parentRunId : undefined;
    const guidance = parentRunId
      ? `Use the parent run instead:\nresearch-xm follow-up ${parentRunId} --execute`
      : "Choose a non-follow-up parent run manually and run research-xm follow-up <parentRunId> --execute.";
    throw new Error(
      `${prefix} is already a follow-up run at depth ${parentDepth}.\nFollow-up execution is limited to depth 1 in this release.\n${guidance}`
    );
  }
  const config = await buildRunConfig({
    inlinePrompt: result.prompt,
    profile: options.profile as "smoke5" | "normal100" | "deep500" | undefined,
    model: options.model,
    focus: options.focus as "web" | "github" | undefined,
    searchProvider: options.searchProvider as "opencode-web" | "xiaomi-native" | undefined,
    researcherMode: options.researcherMode as "extract" | "mechanical" | undefined,
    reviewReport: options.reviewReport,
    outputDir: options.outputDir,
    maxOutputTokens: options.maxOutputTokens,
    maxTasks: options.maxTasks,
    quotaMode: options.quotaMode as "conservative" | "normal" | "aggressive" | undefined,
    opencodeTimeoutMs: options.opencodeTimeoutMs,
    opencodeRetries: options.opencodeRetries,
    xiaomiTimeoutMs: options.xiaomiTimeoutMs,
    writerTimeoutMs: options.writerTimeoutMs,
    concurrency: options.concurrency,
    notify: Boolean(options.notify),
    verbose: Boolean(options.verbose),
    parentRunId: path.basename(runDir),
    followUpDepth: parentDepth + 1,
    followUpReason: result.followUpReason,
    gapsAddressed: result.gapsAddressed,
    followUpPromptPath: result.path,
    isFollowUpRun: true
  });
  const apiKey = deps.apiKey ?? requireApiKey();
  const runWorkflow = deps.runWorkflow ?? runResearch;
  printQuotaStartupWarnings(config);
  const child = await runWorkflow(config, apiKey);
  return [
    `Follow-up prompt written: ${result.path}`,
    `Follow-up run started: ${child.runId}`,
    `Follow-up run directory: ${child.runDir}`,
    ""
  ].join("\n");
}

export async function printResumeCommand(
  run: string,
  options: ResumeCommandOptions,
  deps: ResumeCommandDeps = {}
): Promise<string> {
  const runDir = await resolveRun(path.resolve(options.outputDir), run);
  const resumeWorkflow = deps.resumeWorkflow ?? resumeResearch;
  const apiKey = deps.apiKey ?? requireApiKey();
  const resumeOptions = normalizeResumeOptions(options);
  const result = await resumeWorkflow(runDir, apiKey, resumeOptions);
  return [
    `Resumed run: ${result.runId}`,
    `Run directory: ${result.runDir}`,
    ...(result.summaryPath ? [`Summary: ${result.summaryPath}`] : []),
    `Report: ${result.reportPath}`,
    `Citation lint: ${result.lintOk ? "ok" : "failed"}`,
    ""
  ].join("\n");
}

type FollowUpCommandOptions = {
  outputDir: string;
  writePromptOnly?: boolean;
  execute?: boolean;
  profile?: string;
  model?: string;
  focus?: string;
  searchProvider?: string;
  researcherMode?: string;
  reviewReport?: boolean;
  maxOutputTokens?: string;
  maxTasks?: string;
  quotaMode?: string;
  opencodeTimeoutMs?: string;
  opencodeRetries?: string;
  xiaomiTimeoutMs?: string;
  writerTimeoutMs?: string;
  concurrency?: string;
  notify?: boolean;
  verbose?: boolean;
};

type FollowUpCommandDeps = {
  runWorkflow?: (config: RunConfig, apiKey: string) => Promise<RunResult>;
  apiKey?: string;
};

type ResumeCommandOptions = {
  outputDir: string;
  reviewReport?: boolean;
  xiaomiTimeoutMs?: string;
  writerTimeoutMs?: string;
  notify?: boolean;
  verbose?: boolean;
};

type ResumeCommandDeps = {
  resumeWorkflow?: (runDir: string, apiKey: string, options: ResumeOptions) => Promise<RunResult>;
  apiKey?: string;
};

function normalizeResumeOptions(options: ResumeCommandOptions): ResumeOptions {
  return {
    ...(options.notify !== undefined ? { notify: Boolean(options.notify) } : {}),
    ...(options.verbose !== undefined ? { verbose: Boolean(options.verbose) } : {}),
    ...(options.xiaomiTimeoutMs !== undefined ? { xiaomiTimeoutMs: parsePositiveInt(options.xiaomiTimeoutMs, "--xiaomi-timeout-ms") } : {}),
    ...(options.writerTimeoutMs !== undefined ? { writerTimeoutMs: parsePositiveInt(options.writerTimeoutMs, "--writer-timeout-ms") } : {}),
    ...(options.reviewReport !== undefined ? { reviewReport: options.reviewReport } : {})
  };
}

function parsePositiveInt(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

if (isDirectExecution()) {
  await createProgram().parseAsync(process.argv);
}

async function readJson(filePath: string): Promise<any> {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function printRunSummary(result: Awaited<ReturnType<typeof runResearch>>): void {
  console.log("Research complete.");
  console.log(`Run: ${result.runId}`);
  if (result.summaryPath) {
    console.log(`Summary: ${result.summaryPath}`);
  }
  console.log(`Report: ${result.reportPath}`);
  console.log(`Profile: ${result.usage.profile}`);
  console.log(`Model: ${result.usage.model}`);
  console.log(`Focus: ${result.focus}`);
  console.log(`Search provider: ${result.searchProvider}`);
  console.log(`Researcher mode: ${result.researcherMode}`);
  console.log(`Quota mode: ${result.usage.quotaMode ?? "normal"}`);
  console.log(`Unique sources: ${result.usage.uniqueSources}`);
  console.log(`Sources used in report: ${result.usage.sourcesUsedInReport}`);
  console.log(`Citation lint: ${result.lintOk ? "ok" : "failed"}`);
  if (!result.lintOk) {
    console.log(`Unknown citation numbers: ${result.lintUnknownNumbers.join(", ")}`);
  }
  console.log(`Total tokens: ${result.usage.total_tokens}`);
  console.log(`Web search tool usage: ${result.usage.web_search_usage.tool_usage}`);
  console.log(`Web search page usage: ${result.usage.web_search_usage.page_usage}`);
  if (result.searchProvider === "opencode-web") {
    console.log(`OpenCode calls: ${result.usage.opencode.calls}`);
    console.log(`OpenCode attempts: ${result.usage.opencode.attempts}`);
    console.log(`OpenCode retries: ${result.usage.opencode.retries}`);
    console.log(`OpenCode failures: ${result.usage.opencode.failures}`);
    if (result.usage.opencode.last_error) {
      console.log(`Last OpenCode error: ${result.usage.opencode.last_error}`);
    }
    console.log(`OpenCode websearch calls: ${result.usage.opencode.websearch_calls}`);
    console.log(`OpenCode webfetch calls: ${result.usage.opencode.webfetch_calls}`);
    if (result.usage.opencode.tokensUnavailable) {
      console.log("OpenCode tokens: unavailable (early exit)");
    } else {
      console.log(`OpenCode tokens: ${result.usage.opencode.tokens.total}`);
    }
  }
  if (result.usage.tokenAccounting) {
    console.log(`Estimated total tokens: ${result.usage.tokenAccounting.total.estimatedTotalTokens}`);
    console.log(`Token accounting completeness: ${result.usage.tokenAccounting.total.tokenAccountingCompleteness}`);
    console.log(`Quota risk: ${result.usage.tokenAccounting.quotaRiskLevel}`);
    for (const warning of result.usage.tokenAccounting.warnings) {
      console.log(`Token accounting warning: ${warning}`);
    }
  }
  console.log(`Researcher calls: ${result.usage.callsByPhase.researcher ?? 0}`);
  console.log(`Report reviewer calls: ${result.usage.callsByPhase.reportReviewer ?? 0}`);
  console.log(`Report review: ${formatReportReview(result.reportReview)}`);
  console.log(`Duration: ${result.usage.duration_seconds ?? 0}`);
}

function printQuotaStartupWarnings(config: RunConfig): void {
  if (config.quotaMode === "conservative" && config.profile.name === "deep500" && !config.maxTasks) {
    console.warn("Warning: conservative quota mode with deep500 can consume many OpenCode attempts; set --max-tasks for tighter control.");
  }
}

function formatReportReview(reportReview: Awaited<ReturnType<typeof runResearch>>["reportReview"]): string {
  if (!reportReview) {
    return "no";
  }
  const readiness =
    typeof reportReview.readinessScore === "number"
      ? `, readinessScore: ${reportReview.readinessScore} / ${reportReview.scoreLabel ?? "unlabeled"}`
      : typeof reportReview.qualityScore === "number"
        ? `, qualityScore: ${reportReview.qualityScore}`
        : "";
  const parsing = reportReview.parseFallback ? ", parsing: fallback" : "";
  return `yes, readyForUse: ${reportReview.readyForUse}${readiness}${parsing}`;
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

async function readOptionalJson(filePath: string): Promise<any | undefined> {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
  }
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  return Boolean(entry && import.meta.url === pathToFileURL(path.resolve(entry)).href);
}

async function playNotification(success: boolean): Promise<void> {
  try {
    if (process.platform === "win32") {
      const command = success
        ? "[console]::beep(880,700); [console]::beep(1100,700)"
        : "[console]::beep(300,1000)";
      await new Promise<void>((resolve) => {
        const child = spawn("powershell.exe", ["-NoProfile", "-Command", command], {
          stdio: "ignore",
          windowsHide: true
        });
        child.on("error", () => resolve());
        child.on("close", () => resolve());
      });
      return;
    }
    process.stderr.write("\x07");
  } catch {
    // Notification is best effort only.
  }
}

function exitWithError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exit(1);
}
