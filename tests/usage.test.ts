import { describe, expect, it } from "vitest";
import { UsageTracker } from "../src/store/usage.js";

describe("UsageTracker", () => {
  it("aggregates calls, tokens, web usage, and errors", () => {
    const tracker = new UsageTracker("2026-01-01T00:00:00.000Z", "normal100", "mimo-v2.5-pro");
    tracker.addCall("planner", { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 });
    tracker.addCall("researcher", {
      prompt_tokens: 5,
      completion_tokens: 6,
      total_tokens: 11,
      web_search_usage: { tool_usage: 2, page_usage: 8 }
    });
    tracker.addCall("reportReviewer", { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 });
    tracker.addOpenCodeUsage({
      calls: 2,
      websearchCalls: 2,
      webfetchCalls: 1,
      tokensUnavailable: true
    });
    tracker.addRawSources(10);
    tracker.addError();

    const summary = tracker.finish(7, 3);

    expect(summary.totalCalls).toBe(3);
    expect(summary.callsByPhase).toEqual({ planner: 1, researcher: 1, reportReviewer: 1 });
    expect(summary.prompt_tokens).toBe(18);
    expect(summary.completion_tokens).toBe(30);
    expect(summary.total_tokens).toBe(48);
    expect(summary.web_search_usage).toEqual({ tool_usage: 2, page_usage: 8 });
    expect(summary.xiaomi.total_tokens).toBe(48);
    expect(summary.opencode).toEqual({
      calls: 2,
      websearch_calls: 2,
      webfetch_calls: 1,
      tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0 },
      tokensUnavailable: true,
      cost: null
    });
    expect(summary.sources).toEqual({ raw_sources: 10, unique_sources: 7, used_in_report: 3 });
    expect(summary.uniqueSources).toBe(7);
    expect(summary.sourcesUsedInReport).toBe(3);
    expect(summary.errors).toBe(1);
  });
});
