import { describe, expect, it } from "vitest";
import { lintCitations } from "../src/evidence/citation-linter.js";
import type { Source } from "../src/types.js";

const sources: Source[] = [
  {
    id: "S0001",
    citationIndex: 1,
    url: "https://example.com/a",
    canonicalUrl: "https://example.com/a",
    firstSeenInTaskId: "T001",
    seenCount: 1
  },
  {
    id: "S0002",
    citationIndex: 2,
    url: "https://example.com/b",
    canonicalUrl: "https://example.com/b",
    firstSeenInTaskId: "T001",
    seenCount: 1
  }
];

describe("lintCitations", () => {
  it("accepts known numbered citations", () => {
    const result = lintCitations("Claim [1]. Another claim [2].", sources);
    expect(result.ok).toBe(true);
    expect(result.sourcesUsed).toBe(2);
  });

  it("reports unknown citation numbers", () => {
    const result = lintCitations("Claim [1]. Bad claim [9].", sources);
    expect(result.ok).toBe(false);
    expect(result.unknownNumbers).toEqual([9]);
    expect(result.sourcesUsed).toBe(1);
  });
});
