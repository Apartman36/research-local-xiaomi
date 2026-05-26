import { describe, expect, it } from "vitest";
import { fallbackReportReview, parseReportReviewContent } from "../src/agents/report-reviewer.js";

describe("report reviewer parsing", () => {
  it("parses valid report review JSON", () => {
    const parsed = parseReportReviewContent(
      JSON.stringify({
        overallAssessment: "The report is coherent and mostly well cited.",
        qualityScore: 82,
        citationAssessment: {
          hasUnsupportedClaims: false,
          unsupportedClaims: [],
          citationCoverage: "Most material claims have citations."
        },
        sourceQuality: {
          strongSources: ["Official docs"],
          weakSources: ["Vendor marketing"],
          marketingHeavy: true,
          notes: "Some evidence is marketing-heavy."
        },
        gaps: [
          {
            gap: "No implementation benchmark.",
            whyItMatters: "Performance remains uncertain.",
            suggestedFollowUpQuery: "benchmark implementation"
          }
        ],
        recommendations: ["Acknowledge benchmark gap."],
        readyForUse: true
      })
    );

    expect(parsed.parseFailed).toBeUndefined();
    expect(parsed.review.readyForUse).toBe(true);
    expect(parsed.review.qualityScore).toBe(82);
  });

  it("returns a valid fallback review for malformed JSON", () => {
    const parsed = parseReportReviewContent('{"overallAssessment":"broken","qualityScore":}');

    expect(parsed.parseFailed).toBe(true);
    expect(parsed.review).toEqual(fallbackReportReview("Report reviewer returned malformed JSON."));
  });
});
