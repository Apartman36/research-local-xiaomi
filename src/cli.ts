#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { buildRunConfig, DEFAULT_BASE_URL, DEFAULT_MODEL, requireApiKey } from "./config.js";
import { lintCitations } from "./evidence/citation-linter.js";
import { chat, chatWithWebSearch, extractAnnotations, extractUsage } from "./providers/xiaomi.js";
import { runResearch } from "./orchestrator.js";
import { listRuns, resolveRun } from "./store/run-store.js";
import type { Source } from "./types.js";

const program = new Command();

program
  .name("research-xm")
  .description("Local research orchestration CLI powered by Xiaomi MiMo Web Search.")
  .version("0.1.0");

program
  .command("run")
  .description("Run a local research workflow.")
  .argument("[prompt]", "short inline research prompt")
  .option("-f, --file <path>", "read a long research prompt from a Markdown/text file")
  .option("--profile <normal100|deep500>", "research profile", "normal100")
  .option("--model <model>", "model for all roles", DEFAULT_MODEL)
  .option("--focus <web|github>", "research focus mode", "web")
  .option("--output-dir <path>", "run output root directory", "./runs")
  .option("--max-output-tokens <number>", "writer max completion tokens; other roles are capped by their defaults")
  .option("--concurrency <number>", "max concurrent researcher calls", "3")
  .option("--dry-run", "create artifacts without calling Xiaomi")
  .option("--verbose", "print debug event metadata")
  .action(async (prompt: string | undefined, options: Record<string, unknown>) => {
    try {
      const config = await buildRunConfig({
        file: options.file as string | undefined,
        inlinePrompt: prompt,
        profile: options.profile as "normal100" | "deep500" | undefined,
        model: options.model as string | undefined,
        focus: options.focus as "web" | "github" | undefined,
        outputDir: options.outputDir as string | undefined,
        maxOutputTokens: options.maxOutputTokens as string | undefined,
        concurrency: options.concurrency as string | undefined,
        dryRun: Boolean(options.dryRun),
        verbose: Boolean(options.verbose)
      });
      const apiKey = config.dryRun ? "dry-run" : requireApiKey();
      const result = await runResearch(config, apiKey);
      printRunSummary(result);
    } catch (error) {
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
      const usage = await readJson(path.join(runDir, "usage.json"));
      console.log(`Run: ${path.basename(runDir)}`);
      console.log(`Directory: ${runDir}`);
      console.log(`Report: ${path.join(runDir, "report.md")}`);
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
      const report = await readFile(path.join(runDir, "report.md"), "utf8");
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

program.parseAsync(process.argv);

async function readJson(filePath: string): Promise<any> {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function printRunSummary(result: Awaited<ReturnType<typeof runResearch>>): void {
  console.log("Research complete.");
  console.log(`Run: ${result.runId}`);
  console.log(`Report: ${result.reportPath}`);
  console.log(`Profile: ${result.usage.profile}`);
  console.log(`Model: ${result.usage.model}`);
  console.log(`Focus: ${result.focus}`);
  console.log(`Unique sources: ${result.usage.uniqueSources}`);
  console.log(`Sources used in report: ${result.usage.sourcesUsedInReport}`);
  console.log(`Total tokens: ${result.usage.total_tokens}`);
  console.log(`Web search tool usage: ${result.usage.web_search_usage.tool_usage}`);
  console.log(`Web search page usage: ${result.usage.web_search_usage.page_usage}`);
  console.log(`Duration: ${result.usage.duration_seconds ?? 0}`);
}

function exitWithError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exit(1);
}
