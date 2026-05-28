import { describe, expect, it } from "vitest";
import { fallbackReportReview, parseReportReviewContent, renderReportReviewMarkdown } from "../src/agents/report-reviewer.js";

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

  it("normalizes invalid readinessScore values conservatively", () => {
    const parsed = parseReportReviewContent(
      JSON.stringify({
        overallAssessment: "Overstated.",
        readyForUse: false,
        readinessScore: 7,
        scoreLabel: "strong",
        topGaps: [],
        topRecommendations: [],
        sourceQualityNotes: [],
        followUpQueries: []
      })
    );

    expect(parsed.parseFailed).toBeUndefined();
    expect(parsed.review.readinessScore).toBe(-1);
    expect(parsed.review.scoreLabel).toBe("weak");
    expect(parsed.review.invalidReadinessScore).toBe(7);
    expect(parsed.review.validationWarning).toContain("invalid readinessScore");
  });

  it("keeps valid high and low readiness scores", () => {
    const strong = parseReportReviewContent(
      JSON.stringify({
        overallAssessment: "Strong.",
        readyForUse: true,
        readinessScore: 2,
        scoreLabel: "strong"
      })
    );
    const harmful = parseReportReviewContent(
      JSON.stringify({
        overallAssessment: "Misleading.",
        readyForUse: false,
        readinessScore: -2,
        scoreLabel: "harmful"
      })
    );

    expect(strong.review.readinessScore).toBe(2);
    expect(strong.review.scoreLabel).toBe("strong");
    expect(harmful.review.readinessScore).toBe(-2);
    expect(harmful.review.scoreLabel).toBe("harmful");
  });

  it("parses numeric string readinessScore consistently", () => {
    const parsed = parseReportReviewContent(
      JSON.stringify({
        overallAssessment: "Strong enough.",
        readyForUse: true,
        readinessScore: "2",
        scoreLabel: "weak"
      })
    );

    expect(parsed.review.readinessScore).toBe(2);
    expect(parsed.review.scoreLabel).toBe("strong");
  });

  it("treats missing readinessScore as a conservative parse warning", () => {
    const parsed = parseReportReviewContent(
      JSON.stringify({
        overallAssessment: "Missing score.",
        readyForUse: false,
        scoreLabel: "strong"
      })
    );

    expect(parsed.parseFailed).toBeUndefined();
    expect(parsed.review.readinessScore).toBe(-1);
    expect(parsed.review.scoreLabel).toBe("weak");
    expect(parsed.review.validationWarning).toContain("missing readinessScore");
  });

  it("normalizes scoreLabel conflicts from readinessScore", () => {
    const parsed = parseReportReviewContent(
      JSON.stringify({
        overallAssessment: "Useful with caveats.",
        readyForUse: true,
        readinessScore: 1,
        scoreLabel: "strong"
      })
    );

    expect(parsed.review.readinessScore).toBe(1);
    expect(parsed.review.scoreLabel).toBe("useful");
    expect(parsed.review.validationWarning).toContain("scoreLabel");
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

  it("renders fallback raw output guidance in report review markdown", () => {
    const markdown = renderReportReviewMarkdown({
      ...fallbackReportReview("Report reviewer returned malformed JSON. Raw output was saved for inspection."),
      rawOutputPath: "./report_review_raw.txt"
    });

    expect(markdown).toContain("Report review parsing: fallback");
    expect(markdown).toContain("Report review raw output: ./report_review_raw.txt");
  });
});
