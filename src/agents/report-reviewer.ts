import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { chat, extractUsage } from "../providers/xiaomi.js";
import type { Critique, EvidenceFile, Plan, ReportReview, Source, XiaomiUsage } from "../types.js";
import { extractJsonObject, getAssistantContent } from "./json.js";

const reportReviewSchema = z.object({
  overallAssessment: z.string(),
  qualityScore: z.coerce.number().min(0).max(100),
  citationAssessment: z.object({
    hasUnsupportedClaims: z.boolean(),
    unsupportedClaims: z
      .array(
        z.object({
          claim: z.string(),
          reason: z.string(),
          suggestedFix: z.string().optional()
        })
      )
      .default([]),
    citationCoverage: z.string()
  }),
  sourceQuality: z.object({
    strongSources: z.array(z.string()).default([]),
    weakSources: z.array(z.string()).default([]),
    marketingHeavy: z.boolean(),
    notes: z.string()
  }),
  gaps: z
    .array(
      z.object({
        gap: z.string(),
        whyItMatters: z.string(),
        suggestedFollowUpQuery: z.string().optional()
      })
    )
    .default([]),
  recommendations: z.array(z.string()).default([]),
  readyForUse: z.boolean()
});

export type ReportReviewerResult = {
  review: ReportReview;
  usage?: XiaomiUsage;
  parseFailed?: boolean;
  parseError?: string;
};

export function fallbackReportReview(reason: string): ReportReview {
  return {
    overallAssessment: reason,
    qualityScore: 0,
    citationAssessment: {
      hasUnsupportedClaims: false,
      unsupportedClaims: [],
      citationCoverage: "Report reviewer did not complete; rely on citation_linter output."
    },
    sourceQuality: {
      strongSources: [],
      weakSources: [],
      marketingHeavy: false,
      notes: "Source quality was not reviewed because the reviewer failed."
    },
    gaps: [],
    recommendations: ["Review report.md, sources.json, evidence.json, and citation lint output manually."],
    readyForUse: false
  };
}

export function parseReportReviewContent(content: string): ReportReviewerResult {
  try {
    return { review: reportReviewSchema.parse(extractJsonObject(content)) };
  } catch (error) {
    return {
      review: fallbackReportReview("Report reviewer returned malformed JSON."),
      parseFailed: true,
      parseError: safeError(error)
    };
  }
}

export async function runReportReviewer(params: {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxCompletionTokens: number;
  report: string;
  plan: Plan;
  evidence: EvidenceFile;
  critique: Critique;
  sources: Source[];
  dryRun: boolean;
}): Promise<ReportReviewerResult> {
  if (params.dryRun) {
    return {
      review: {
        overallAssessment: "Dry-run review: artifacts are synthetic and not suitable for real use.",
        qualityScore: 0,
        citationAssessment: {
          hasUnsupportedClaims: false,
          unsupportedClaims: [],
          citationCoverage: "Dry-run report contains synthetic citations."
        },
        sourceQuality: {
          strongSources: [],
          weakSources: ["Dry-run synthetic source"],
          marketingHeavy: false,
          notes: "No real source review was performed."
        },
        gaps: [],
        recommendations: ["Run without --dry-run before using the report."],
        readyForUse: false
      }
    };
  }

  const system = await readFile(path.resolve("src/prompts/report-reviewer.md"), "utf8");
  const response = await chat({
    apiKey: params.apiKey,
    baseUrl: params.baseUrl,
    model: params.model,
    maxCompletionTokens: params.maxCompletionTokens,
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: JSON.stringify(
          {
            report: params.report,
            plan: {
              topic: params.plan.topic,
              objective: params.plan.objective,
              assumptions: params.plan.assumptions,
              subquestions: params.plan.subquestions,
              searchTasks: params.plan.searchTasks
            },
            evidence: params.evidence,
            critique: params.critique,
            sources: params.sources.map((source) => ({
              id: source.id,
              citationIndex: source.citationIndex,
              title: source.title,
              url: source.url,
              summary: source.summary,
              siteName: source.siteName
            }))
          },
          null,
          2
        )
      }
    ]
  });
  const parsed = parseReportReviewContent(getAssistantContent(response));
  return { ...parsed, usage: extractUsage(response) };
}

export function renderReportReviewMarkdown(review: ReportReview): string {
  const unsupported = review.citationAssessment.unsupportedClaims
    .map((item) => `- ${item.claim}: ${item.reason}${item.suggestedFix ? ` Suggested fix: ${item.suggestedFix}` : ""}`)
    .join("\n");
  const gaps = review.gaps
    .map((gap) => `- ${gap.gap}: ${gap.whyItMatters}${gap.suggestedFollowUpQuery ? ` Follow-up: ${gap.suggestedFollowUpQuery}` : ""}`)
    .join("\n");
  return `# Report Review

Overall assessment: ${review.overallAssessment}

Quality score: ${review.qualityScore}

Ready for use: ${review.readyForUse ? "yes" : "no"}

## Citation Assessment

Unsupported claims: ${review.citationAssessment.hasUnsupportedClaims ? "yes" : "no"}

Citation coverage: ${review.citationAssessment.citationCoverage}

${unsupported || "- No unsupported claims listed."}

## Source Quality

Marketing heavy: ${review.sourceQuality.marketingHeavy ? "yes" : "no"}

Notes: ${review.sourceQuality.notes}

Strong sources:
${review.sourceQuality.strongSources.map((source) => `- ${source}`).join("\n") || "- None listed."}

Weak sources:
${review.sourceQuality.weakSources.map((source) => `- ${source}`).join("\n") || "- None listed."}

## Gaps

${gaps || "- No gaps listed."}

## Recommendations

${review.recommendations.map((recommendation) => `- ${recommendation}`).join("\n") || "- None listed."}
`;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 240);
}
