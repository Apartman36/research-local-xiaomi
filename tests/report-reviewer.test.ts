import { describe, expect, it } from "vitest";
import { fallbackReportReview, parseReportReviewContent } from "../src/agents/report-reviewer.js";

describe("report reviewer parsing", () => {
  it("parses valid report review JSON", () => {
    const parsed = parseReportReviewContent(
      JSON.stringify({
        overallAssessment: "The report is coherent and mostly well cited.",
        readinessScore: 1,
        scoreLabel: "useful",
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
    expect(parsed.review.readinessScore).toBe(1);
    expect(parsed.review.scoreLabel).toBe("useful");
  });

  it("parses fenced report review JSON", () => {
    const parsed = parseReportReviewContent(
      [
        "```json",
        JSON.stringify({
          overallAssessment: "Strong enough.",
          readyForUse: true,
          readinessScore: 2,
          scoreLabel: "strong",
          topGaps: [],
          topRecommendations: ["Use it."],
          sourceQualityNotes: ["Good source mix."],
          followUpQueries: []
        }),
        "```"
      ].join("\n")
    );

    expect(parsed.parseFailed).toBeUndefined();
    expect(parsed.review.readinessScore).toBe(2);
    expect(parsed.review.scoreLabel).toBe("strong");
  });

  it("parses JSON surrounded by prose", () => {
    const parsed = parseReportReviewContent(
      `Here is the review:\n${JSON.stringify({
        overallAssessment: "Mixed but useful for scoping.",
        readyForUse: false,
        readinessScore: 0,
        scoreLabel: "mixed",
        topGaps: ["Benchmark gap"],
        topRecommendations: ["Run follow-up."],
        sourceQualityNotes: ["Too few independent sources."],
        followUpQueries: ["independent benchmark"]
      })}\nEnd.`
    );

    expect(parsed.parseFailed).toBeUndefined();
    expect(parsed.review.readinessScore).toBe(0);
    expect(parsed.review.topGaps).toContain("Benchmark gap");
  });

  it("normalizes invalid readinessScore values into the supported scale", () => {
    const parsed = parseReportReviewContent(
      JSON.stringify({
        overallAssessment: "Overstated.",
        readyForUse: false,
        readinessScore: 99,
        scoreLabel: "strong",
        topGaps: [],
        topRecommendations: [],
        sourceQualityNotes: [],
        followUpQueries: []
      })
    );

    expect(parsed.parseFailed).toBeUndefined();
    expect(parsed.review.readinessScore).toBe(2);
    expect(parsed.review.scoreLabel).toBe("strong");
  });

  it("returns a valid fallback review for malformed JSON", () => {
    const parsed = parseReportReviewContent('{"overallAssessment":"broken","qualityScore":}');

    expect(parsed.parseFailed).toBe(true);
    expect(parsed.rawContent).toContain("qualityScore");
    expect(parsed.review).toEqual(
      fallbackReportReview("Report reviewer returned malformed JSON. Raw output was saved for inspection.")
    );
    expect(parsed.review.readinessScore).toBe(-1);
    expect(parsed.review.scoreLabel).toBe("weak");
  });
});
