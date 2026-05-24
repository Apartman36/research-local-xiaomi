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
    tracker.addOpenCodeUsage({
      calls: 2,
      websearchCalls: 2,
      webfetchCalls: 1,
      tokens: { total: 100, input: 70, output: 20, reasoning: 5, cacheRead: 4, cacheWrite: 1 }
    });
    tracker.addRawSources(10);
    tracker.addError();

    const summary = tracker.finish(7, 3);

    expect(summary.totalCalls).toBe(2);
    expect(summary.callsByPhase).toEqual({ planner: 1, researcher: 1 });
    expect(summary.prompt_tokens).toBe(15);
    expect(summary.completion_tokens).toBe(26);
    expect(summary.total_tokens).toBe(41);
    expect(summary.web_search_usage).toEqual({ tool_usage: 2, page_usage: 8 });
    expect(summary.xiaomi.total_tokens).toBe(41);
    expect(summary.opencode).toEqual({
      calls: 2,
      websearch_calls: 2,
      webfetch_calls: 1,
      tokens: { total: 100, input: 70, output: 20, reasoning: 5, cache_read: 4, cache_write: 1 },
      cost: null
    });
    expect(summary.sources).toEqual({ raw_sources: 10, unique_sources: 7, used_in_report: 3 });
    expect(summary.uniqueSources).toBe(7);
    expect(summary.sourcesUsedInReport).toBe(3);
    expect(summary.errors).toBe(1);
  });
});
