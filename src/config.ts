import { readFile } from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";
import { deep500 } from "./profiles/deep500.js";
import { normal100 } from "./profiles/normal100.js";
import { smoke5 } from "./profiles/smoke5.js";
import { DEFAULT_OPENCODE_MODEL } from "./search/search-provider.js";
import type { ResearchFocus, ResearchProfile, ResearchProfileName, ResearcherMode, RoleTokenLimits, RunConfig } from "./types.js";

dotenv.config({ quiet: true });

export const DEFAULT_BASE_URL = "https://token-plan-sgp.xiaomimimo.com/v1";
export const DEFAULT_MODEL = "mimo-v2.5-pro";

const profileMap: Record<ResearchProfileName, ResearchProfile> = {
  smoke5,
  normal100,
  deep500
};

const runOptionsSchema = z.object({
  file: z.string().optional(),
  inlinePrompt: z.string().optional(),
  profile: z.enum(["smoke5", "normal100", "deep500"]).default("normal100"),
  model: z.string().default(DEFAULT_MODEL),
  focus: z.enum(["web", "github"]).default("web"),
  searchProvider: z.enum(["opencode-web", "xiaomi-native"]).default("opencode-web"),
  researcherMode: z.enum(["extract", "mechanical"]).default("extract"),
  reviewReport: z.boolean().default(true),
  notify: z.boolean().default(false),
  outputDir: z.string().default("./runs"),
  maxOutputTokens: z.coerce.number().int().positive().optional(),
  maxTasks: z.coerce.number().int().positive().optional(),
  opencodeTimeoutMs: z.coerce.number().int().positive().default(180_000),
  opencodeRetries: z.coerce.number().int().min(0).max(5).default(2),
  xiaomiTimeoutMs: z.coerce.number().int().min(1000).max(600_000).default(120_000),
  writerTimeoutMs: z.coerce.number().int().min(1000).max(600_000).optional(),
  concurrency: z.coerce.number().int().positive().default(3),
  dryRun: z.boolean().default(false),
  verbose: z.boolean().default(false),
  parentRunId: z.string().optional(),
  followUpDepth: z.coerce.number().int().positive().optional(),
  followUpReason: z.string().optional(),
  gapsAddressed: z.array(z.string()).optional(),
  followUpPromptPath: z.string().optional(),
  isFollowUpRun: z.boolean().optional()
});

export type BuildRunConfigOptions = z.input<typeof runOptionsSchema>;

export function getProfile(name: ResearchProfileName): ResearchProfile {
  return profileMap[name];
}

export async function loadPrompt(filePath?: string, inlinePrompt?: string): Promise<string> {
  if (filePath) {
    return readFile(path.resolve(filePath), "utf8");
  }
  if (inlinePrompt?.trim()) {
    return inlinePrompt.trim();
  }
  throw new Error("Provide a research prompt with --file <path> or an inline prompt argument.");
}

export async function buildRunConfig(options: BuildRunConfigOptions): Promise<RunConfig> {
  const parsed = runOptionsSchema.parse(options);
  const prompt = await loadPrompt(parsed.file, parsed.inlinePrompt);
  const profile = getProfile(parsed.profile);
  const runId = createRunId();
  const outputDirRoot = path.resolve(parsed.outputDir);
  const roleTokens: RoleTokenLimits = {
    planner: 4000,
    researcher: 6000,
    critic: 4000,
    writer: parsed.maxOutputTokens ?? 16000,
    reportReviewer: 4000
  };
  if (parsed.maxOutputTokens) {
    roleTokens.planner = Math.min(parsed.maxOutputTokens, roleTokens.planner);
    roleTokens.researcher = Math.min(parsed.maxOutputTokens, roleTokens.researcher);
    roleTokens.critic = Math.min(parsed.maxOutputTokens, roleTokens.critic);
    roleTokens.reportReviewer = Math.min(parsed.maxOutputTokens, roleTokens.reportReviewer);
  }

  return {
    runId,
    prompt,
    profile,
    focus: parsed.focus as ResearchFocus,
    searchProvider: parsed.searchProvider,
    outputDirRoot,
    runDir: path.join(outputDirRoot, runId),
    apiBaseUrl: process.env.XIAOMI_MIMO_BASE_URL ?? DEFAULT_BASE_URL,
    model: parsed.model,
    opencodeModel: process.env.OPENCODE_MODEL ?? DEFAULT_OPENCODE_MODEL,
    opencodeTimeoutMs: parsed.opencodeTimeoutMs,
    opencodeRetries: parsed.opencodeRetries,
    xiaomiTimeoutMs: parsed.xiaomiTimeoutMs,
    writerTimeoutMs: parsed.writerTimeoutMs,
    roleModels: {
      planner: parsed.model,
      researcher: parsed.model,
      critic: parsed.model,
      writer: parsed.model,
      reportReviewer: parsed.model
    },
    maxOutputTokens: roleTokens,
    concurrency: Math.min(parsed.concurrency, profile.maxConcurrentSearches),
    maxTasks: parsed.maxTasks,
    researcherMode: parsed.researcherMode as ResearcherMode,
    reviewReport: parsed.reviewReport,
    notify: parsed.notify,
    dryRun: parsed.dryRun,
    verbose: parsed.verbose,
    startedAt: new Date().toISOString(),
    parentRunId: parsed.parentRunId,
    followUpDepth: parsed.followUpDepth,
    followUpReason: parsed.followUpReason,
    gapsAddressed: parsed.gapsAddressed,
    followUpPromptPath: parsed.followUpPromptPath,
    isFollowUpRun: parsed.isFollowUpRun
  };
}

export function requireApiKey(): string {
  const apiKey = process.env.XIAOMI_MIMO_API_KEY;
  if (!apiKey) {
    throw new Error("Missing XIAOMI_MIMO_API_KEY. Add it to your environment or .env file.");
  }
  return apiKey;
}

function createRunId(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${stamp}-xm`;
}
