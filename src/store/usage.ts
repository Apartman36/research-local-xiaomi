import type { Phase, QuotaMode, ResearchProfileName, TokenAccounting, UsageSummary, XiaomiUsage } from "../types.js";
import type { SearchProviderUsage } from "../search/search-provider.js";

export const DEFAULT_OPENCODE_ATTEMPT_TOKEN_ESTIMATE = 3000;

export class UsageTracker {
  private readonly summary: UsageSummary;

  constructor(startedAt: string, profile: ResearchProfileName, model: string, quotaMode: QuotaMode = "normal") {
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
      quotaMode,
      xiaomi: {
        calls: 0,
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      },
      opencode: {
        calls: 0,
        attempts: 0,
        websearch_calls: 0,
        webfetch_calls: 0,
        retries: 0,
        failures: 0,
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
    if (phase === "promptNormalizer") {
      this.summary.promptNormalizerCalls = (this.summary.promptNormalizerCalls ?? 0) + 1;
    }
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
    this.summary.opencode.attempts += numeric(usage.attempts, usage.calls);
    this.summary.opencode.websearch_calls += numeric(usage.websearchCalls);
    this.summary.opencode.webfetch_calls += numeric(usage.webfetchCalls);
    this.summary.opencode.retries += numeric(usage.retries);
    this.summary.opencode.failures += numeric(usage.failures);
    if (usage.lastError) {
      this.summary.opencode.last_error = usage.lastError;
    }
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
    this.summary.tokenAccounting = buildTokenAccounting(this.summary);
    return { ...this.summary, callsByPhase: { ...this.summary.callsByPhase } };
  }

  snapshot(): UsageSummary {
    return { ...this.summary, callsByPhase: { ...this.summary.callsByPhase } };
  }
}

export function buildTokenAccounting(summary: UsageSummary): TokenAccounting {
  const knownDirectTokens = numeric(summary.xiaomi.total_tokens, summary.total_tokens);
  const openCodeAttempts = numeric(summary.opencode.attempts, summary.opencode.calls);
  const openCodeCalls = numeric(summary.opencode.calls);
  const reportedOpenCodeTokens = numeric(summary.opencode.tokens.total);
  const hasReportedOpenCodeTokens = reportedOpenCodeTokens > 0 && !summary.opencode.tokensUnavailable;
  const hasOpenCodeActivity = openCodeAttempts > 0 || openCodeCalls > 0;
  const openCodeReason = hasReportedOpenCodeTokens
    ? "reported"
    : !hasOpenCodeActivity
      ? "not_applicable"
      : summary.opencode.tokensUnavailable
        ? "early_exit"
        : "not_reported";
  const openCodeKnown = openCodeReason === "reported" || openCodeReason === "not_applicable";
  const estimatedOpenCodeTokens = openCodeKnown ? 0 : openCodeAttempts * DEFAULT_OPENCODE_ATTEMPT_TOKEN_ESTIMATE;
  const estimatedTotalTokens = knownDirectTokens + (hasReportedOpenCodeTokens ? reportedOpenCodeTokens : estimatedOpenCodeTokens);
  const totalKnown = openCodeKnown;
  const completeness = totalKnown
    ? "complete"
    : estimatedOpenCodeTokens > 0
      ? "estimated"
      : knownDirectTokens > 0
        ? "direct-only"
        : "unavailable";

  return {
    schemaVersion: 1,
    directXiaomi: {
      known: true,
      promptTokens: numeric(summary.xiaomi.prompt_tokens, summary.prompt_tokens),
      completionTokens: numeric(summary.xiaomi.completion_tokens, summary.completion_tokens),
      totalTokens: knownDirectTokens,
      calls: numeric(summary.xiaomi.calls, summary.totalCalls)
    },
    openCode: {
      known: openCodeKnown,
      tokens: hasReportedOpenCodeTokens ? reportedOpenCodeTokens : null,
      calls: openCodeCalls,
      attempts: openCodeAttempts,
      successfulCalls: openCodeCalls,
      reason: openCodeReason,
      estimatedTokens: estimatedOpenCodeTokens,
      estimateMethod: estimatedOpenCodeTokens > 0 ? "calls_multiplier" : "none"
    },
    total: {
      known: totalKnown,
      knownDirectTokens,
      estimatedTotalTokens,
      isLowerBound: !totalKnown,
      tokenAccountingCompleteness: completeness
    },
    quotaRiskLevel: quotaRiskLevel(summary.quotaMode ?? "normal", estimatedTotalTokens),
    warnings: buildTokenAccountingWarnings(summary, openCodeKnown, openCodeReason, estimatedOpenCodeTokens)
  };
}

function buildTokenAccountingWarnings(
  summary: UsageSummary,
  openCodeKnown: boolean,
  openCodeReason: TokenAccounting["openCode"]["reason"],
  estimatedOpenCodeTokens: number
): string[] {
  const warnings: string[] = [];
  if (!openCodeKnown && openCodeReason !== "not_applicable") {
    warnings.push("OpenCode token usage was not reported. Estimated OpenCode usage is a rough heuristic; total token usage is a lower bound.");
  }
  if ((summary.quotaMode ?? "normal") === "conservative" && summary.profile === "deep500") {
    warnings.push("Conservative quota mode with deep500 can consume many OpenCode attempts; prefer setting --max-tasks explicitly.");
  }
  if ((summary.quotaMode ?? "normal") === "conservative" && estimatedOpenCodeTokens > 0) {
    warnings.push("Conservative quota mode treats OpenCode estimates as higher risk; consider a smaller --max-tasks value.");
  }
  return warnings;
}

function quotaRiskLevel(quotaMode: QuotaMode, estimatedTotalTokens: number): TokenAccounting["quotaRiskLevel"] {
  const thresholds = {
    conservative: { amber: 25_000, red: 75_000 },
    normal: { amber: 50_000, red: 150_000 },
    aggressive: { amber: 150_000, red: 500_000 }
  } satisfies Record<QuotaMode, { amber: number; red: number }>;
  const selected = thresholds[quotaMode];
  if (estimatedTotalTokens >= selected.red) {
    return "red";
  }
  if (estimatedTotalTokens >= selected.amber) {
    return "amber";
  }
  return "green";
}

function numeric(...values: unknown[]): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return 0;
}
