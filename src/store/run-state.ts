import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeJson } from "./atomic-write.js";
import type { RunConfig, RunStage, RunStateFile } from "../types.js";

export const RUN_STATE_ARTIFACTS: Record<string, string> = {
  input: "input.md",
  config: "config.json",
  plan: "plan.json",
  queries: "queries.json",
  sources: "sources.json",
  evidence: "evidence.json",
  critique: "critique.json",
  report: "report.md",
  reportReview: "report_review.json",
  citationLint: "citation_lint.json",
  runSummary: "run_summary.md"
};

const RESUMABLE_STAGES = new Set<RunStage>(["writer", "reportReviewer", "citationLint", "summary"]);

export class RunStateTracker {
  private constructor(
    private readonly filePath: string,
    private state: RunStateFile
  ) {}

  static async create(config: RunConfig): Promise<RunStateTracker> {
    const tracker = new RunStateTracker(path.join(config.runDir, "state.json"), {
      schemaVersion: 1,
      runId: config.runId,
      status: "running",
      currentStage: "planner",
      completedStages: [],
      failedStage: null,
      lastError: null,
      updatedAt: new Date().toISOString(),
      canResume: true,
      artifacts: RUN_STATE_ARTIFACTS
    });
    await tracker.persist();
    return tracker;
  }

  static async loadOrCreate(config: RunConfig): Promise<RunStateTracker> {
    const filePath = path.join(config.runDir, "state.json");
    try {
      const state = JSON.parse(await readFile(filePath, "utf8")) as RunStateFile;
      return new RunStateTracker(filePath, {
        ...state,
        artifacts: { ...RUN_STATE_ARTIFACTS, ...state.artifacts }
      });
    } catch (error) {
      if (isMissingFileError(error)) {
        return RunStateTracker.create(config);
      }
      throw error;
    }
  }

  get snapshot(): RunStateFile {
    return { ...this.state, completedStages: [...this.state.completedStages], artifacts: { ...this.state.artifacts } };
  }

  async start(stage: RunStage): Promise<void> {
    this.state = {
      ...this.state,
      status: "running",
      currentStage: stage,
      failedStage: null,
      lastError: null,
      canResume: true,
      updatedAt: new Date().toISOString()
    };
    await this.persist();
  }

  async complete(stage: RunStage): Promise<void> {
    const completedStages = this.state.completedStages.includes(stage)
      ? this.state.completedStages
      : [...this.state.completedStages, stage];
    this.state = {
      ...this.state,
      status: "running",
      completedStages,
      currentStage: stage,
      updatedAt: new Date().toISOString()
    };
    await this.persist();
  }

  async fail(errorMessage: string, stage: RunStage = this.state.currentStage): Promise<void> {
    this.state = {
      ...this.state,
      status: "failed",
      currentStage: stage,
      failedStage: stage,
      lastError: errorMessage,
      canResume: RESUMABLE_STAGES.has(stage),
      updatedAt: new Date().toISOString()
    };
    await this.persist();
  }

  async completed(): Promise<void> {
    this.state = {
      ...this.state,
      status: "completed",
      currentStage: "completed",
      failedStage: null,
      lastError: null,
      canResume: false,
      updatedAt: new Date().toISOString()
    };
    await this.persist();
  }

  private async persist(): Promise<void> {
    await writeJson(this.filePath, this.state);
  }
}

export async function readRunState(runDir: string): Promise<RunStateFile | undefined> {
  try {
    return JSON.parse(await readFile(path.join(runDir, "state.json"), "utf8")) as RunStateFile;
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
