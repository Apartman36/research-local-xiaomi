import type { Phase, ResearchProfileName, UsageSummary, XiaomiUsage } from "../types.js";
import type { SearchProviderUsage } from "../search/search-provider.js";

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
      model,
      xiaomi: {
        calls: 0,
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      },
      opencode: {
        calls: 0,
        websearch_calls: 0,
        webfetch_calls: 0,
        tokens: {
          total: 0,
          input: 0,
          output: 0,
          reasoning: 0,
          cache_read: 0,
          cache_write: 0
        },
        cost: null
      },
      sources: {
        raw_sources: 0,
        unique_sources: 0,
        used_in_report: 0
      }
    };
  }

  addCall(phase: Phase, usage?: XiaomiUsage): void {
    this.summary.totalCalls += 1;
    this.summary.xiaomi.calls += 1;
    this.summary.callsByPhase[phase] = (this.summary.callsByPhase[phase] ?? 0) + 1;
    if (!usage) {
      return;
    }
    this.summary.prompt_tokens += numeric(usage.prompt_tokens);
    this.summary.completion_tokens += numeric(usage.completion_tokens);
    this.summary.total_tokens += numeric(usage.total_tokens);
    this.summary.xiaomi.prompt_tokens += numeric(usage.prompt_tokens);
    this.summary.xiaomi.completion_tokens += numeric(usage.completion_tokens);
    this.summary.xiaomi.total_tokens += numeric(usage.total_tokens);
    this.summary.web_search_usage.tool_usage += numeric(usage.web_search_usage?.tool_usage);
    this.summary.web_search_usage.page_usage += numeric(usage.web_search_usage?.page_usage);
  }

  addOpenCodeUsage(usage?: SearchProviderUsage): void {
    if (!usage) {
      return;
    }
    this.summary.opencode.calls += numeric(usage.calls);
    this.summary.opencode.websearch_calls += numeric(usage.websearchCalls);
    this.summary.opencode.webfetch_calls += numeric(usage.webfetchCalls);
    if (usage.tokensUnavailable) {
      this.summary.opencode.tokensUnavailable = true;
    }
    this.summary.opencode.tokens.total += numeric(usage.tokens?.total);
    this.summary.opencode.tokens.input += numeric(usage.tokens?.input);
    this.summary.opencode.tokens.output += numeric(usage.tokens?.output);
    this.summary.opencode.tokens.reasoning += numeric(usage.tokens?.reasoning);
    this.summary.opencode.tokens.cache_read += numeric(usage.tokens?.cacheRead);
    this.summary.opencode.tokens.cache_write += numeric(usage.tokens?.cacheWrite);
  }

  addRawSources(count: number): void {
    this.summary.sources.raw_sources += count;
  }

  addError(): void {
    this.summary.errors += 1;
  }

  finish(uniqueSources: number, sourcesUsedInReport: number): UsageSummary {
    const finishedAt = new Date();
    const startedAt = new Date(this.summary.started_at);
    this.summary.uniqueSources = uniqueSources;
    this.summary.sourcesUsedInReport = sourcesUsedInReport;
    this.summary.sources.unique_sources = uniqueSources;
    this.summary.sources.used_in_report = sourcesUsedInReport;
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
