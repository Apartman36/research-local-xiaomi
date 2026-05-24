import type { Phase, ResearchProfileName, UsageSummary, XiaomiUsage } from "../types.js";

export class UsageTracker {
  private readonly summary: UsageSummary;

  constructor(startedAt: string, profile: ResearchProfileName, model: string) {
    this.summary = {
      totalCalls: 0,
      callsByPhase: {},
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      web_search_usage: {
        tool_usage: 0,
        page_usage: 0
      },
      uniqueSources: 0,
      sourcesUsedInReport: 0,
      errors: 0,
      started_at: startedAt,
      profile,
      model
    };
  }

  addCall(phase: Phase, usage?: XiaomiUsage): void {
    this.summary.totalCalls += 1;
    this.summary.callsByPhase[phase] = (this.summary.callsByPhase[phase] ?? 0) + 1;
    if (!usage) {
      return;
    }
    this.summary.prompt_tokens += numeric(usage.prompt_tokens);
    this.summary.completion_tokens += numeric(usage.completion_tokens);
    this.summary.total_tokens += numeric(usage.total_tokens);
    this.summary.web_search_usage.tool_usage += numeric(usage.web_search_usage?.tool_usage);
    this.summary.web_search_usage.page_usage += numeric(usage.web_search_usage?.page_usage);
  }

  addError(): void {
    this.summary.errors += 1;
  }

  finish(uniqueSources: number, sourcesUsedInReport: number): UsageSummary {
    const finishedAt = new Date();
    const startedAt = new Date(this.summary.started_at);
    this.summary.uniqueSources = uniqueSources;
    this.summary.sourcesUsedInReport = sourcesUsedInReport;
    this.summary.finished_at = finishedAt.toISOString();
    this.summary.duration_seconds = Math.max(0, Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000));
    return { ...this.summary, callsByPhase: { ...this.summary.callsByPhase } };
  }

  snapshot(): UsageSummary {
    return { ...this.summary, callsByPhase: { ...this.summary.callsByPhase } };
  }
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
