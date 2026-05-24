import { describe, expect, it } from "vitest";
import { parseOpenCodeEvents } from "../src/search/parse-opencode-events.js";

describe("parseOpenCodeEvents", () => {
  it("extracts websearch sources and aggregates step tokens", () => {
    const output = [
      JSON.stringify({
        type: "tool_use",
        part: {
          type: "tool",
          tool: "websearch",
          state: {
            status: "completed",
            input: { query: "AI interior design 2026", numResults: 5 },
            output:
              "Title: Versee\nURL: https://www.versee.ai/\nPublished: N/A\nAuthor: N/A\nHighlights:\nAI 3D apartment visualization.\n\n---\n\nTitle: Habitas\nURL: https://habitas.ai/\nPublished: 2026-02-03T14:00:01.000Z\nAuthor: Habitas\nHighlights:\nAI interior design tool.",
            metadata: { provider: "exa", truncated: false }
          }
        }
      }),
      JSON.stringify({
        type: "tool_use",
        part: {
          type: "tool",
          tool: "webfetch",
          state: { status: "completed", output: "Fetched" }
        }
      }),
      JSON.stringify({
        type: "step_finish",
        part: {
          tokens: {
            total: 6258,
            input: 5152,
            output: 45,
            reasoning: 37,
            cache: { write: 3, read: 1024 }
          }
        }
      })
    ].join("\n");

    const result = parseOpenCodeEvents(output, { taskId: "T001", query: "AI interior design 2026" });

    expect(result.sources).toHaveLength(2);
    expect(result.usage).toEqual({
      calls: 1,
      websearchCalls: 1,
      webfetchCalls: 1,
      tokens: {
        total: 6258,
        input: 5152,
        output: 45,
        reasoning: 37,
        cacheRead: 1024,
        cacheWrite: 3
      }
    });
    expect(result.rawEventsCount).toBe(3);
  });

  it("records parse warnings for non-json lines", () => {
    const result = parseOpenCodeEvents("not json\n", { taskId: "T001", query: "query" });

    expect(result.sources).toHaveLength(0);
    expect(result.warnings?.[0]).toContain("Skipped non-JSON");
  });
});

