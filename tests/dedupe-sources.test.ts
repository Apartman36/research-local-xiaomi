import { describe, expect, it } from "vitest";
import { dedupeSources } from "../src/evidence/dedupe-sources.js";
import type { Finding } from "../src/types.js";

describe("dedupeSources", () => {
  it("deduplicates by canonical URL and keeps seen count", () => {
    const findings: Finding[] = [
      {
        taskId: "T001",
        subquestionId: "SQ001",
        query: "query",
        assistantSynthesis: "",
        annotations: [
          { url: "https://EXAMPLE.com/a?utm_source=x", canonicalUrl: "https://example.com/a", title: "First" },
          { url: "https://example.com/b", canonicalUrl: "https://example.com/b", title: "Second" }
        ],
        claims: []
      },
      {
        taskId: "T002",
        subquestionId: "SQ001",
        query: "query 2",
        assistantSynthesis: "",
        annotations: [{ url: "https://example.com/a#frag", canonicalUrl: "https://example.com/a", summary: "Duplicate" }],
        claims: []
      }
    ];

    const sources = dedupeSources(findings, "web");

    expect(sources).toHaveLength(2);
    const duplicate = sources.find((source) => source.canonicalUrl === "https://example.com/a");
    expect(duplicate?.seenCount).toBe(2);
    expect(duplicate?.id).toMatch(/^S\d{4}$/);
    expect(duplicate?.citationIndex).toBeGreaterThan(0);
  });
});
