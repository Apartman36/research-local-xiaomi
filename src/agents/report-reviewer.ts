import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { chat, extractUsage } from "../providers/xiaomi.js";
import type { Critique, EvidenceFile, Plan, ReadinessScore, ReportReview, ScoreLabel, Source, XiaomiUsage } from "../types.js";
import { getAssistantContent } from "./json.js";

const reportReviewSchema = z.object({
  overallAssessment: z.string(),
  readyForUse: z.boolean(),
  readinessScore: z.unknown().optional(),
  scoreLabel: z.enum(["harmful", "weak", "mixed", "useful", "strong"]).optional(),
  topGaps: z.array(z.string()).default([]),
  topRecommendations: z.array(z.string()).default([]),
  sourceQualityNotes: z.array(z.string()).default([]),
  followUpQueries: z.array(z.string()).default([]),
  citationAssessment: z
    .object({
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
    })
    .default({
      hasUnsupportedClaims: false,
      unsupportedClaims: [],
      citationCoverage: "Reviewer did not provide citationAssessment."
    }),
  sourceQuality: z
    .object({
      strongSources: z.array(z.string()).default([]),
      weakSources: z.array(z.string()).default([]),
      marketingHeavy: z.boolean(),
      notes: z.string()
    })
    .default({
      strongSources: [],
      weakSources: [],
      marketingHeavy: false,
      notes: "Reviewer did not provide sourceQuality."
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
  qualityScore: z.coerce.number().min(0).max(100).optional()
});

export type ReportReviewerResult = {
  review: ReportReview;
  usage?: XiaomiUsage;
  parseFailed?: boolean;
  parseError?: string;
  rawContent?: string;
};

export function fallbackReportReview(reason: string): ReportReview {
  return {
    overallAssessment: reason,
    readinessScore: -1,
    scoreLabel: "weak",
    topGaps: ["Reviewer output could not be parsed."],
    topRecommendations: ["Inspect report_review_raw.txt and rerun report review if needed."],
    sourceQualityNotes: ["Source quality was not reviewed because reviewer output could not be parsed."],
    followUpQueries: [],
    parseFallback: true,
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
    gaps: [
      {
        gap: "Reviewer output could not be parsed.",
        whyItMatters: "Malformed QA output prevents reliable reviewer scoring.",
        suggestedFollowUpQuery: "Inspect report_review_raw.txt and rerun report review if needed."
      }
    ],
    recommendations: ["Inspect report_review_raw.txt and rerun report review if needed."],
    readyForUse: false
  };
}

export function parseReportReviewContent(content: string): ReportReviewerResult {
  try {
    const parsed = reportReviewSchema.parse(extractReportReviewJson(content));
    const normalized = normalizeReadinessScore(parsed.readinessScore, parsed.scoreLabel);
    return {
      review: {
        ...parsed,
        readinessScore: normalized.readinessScore,
        scoreLabel: normalized.scoreLabel,
        ...(normalized.validationWarning ? { validationWarning: normalized.validationWarning } : {}),
        ...(normalized.invalidReadinessScore !== undefined ? { invalidReadinessScore: normalized.invalidReadinessScore } : {}),
        topGaps: parsed.topGaps.length > 0 ? parsed.topGaps : parsed.gaps.map((gap) => gap.gap),
        topRecommendations: parsed.topRecommendations.length > 0 ? parsed.topRecommendations : parsed.recommendations,
        sourceQualityNotes: parsed.sourceQualityNotes.length > 0 ? parsed.sourceQualityNotes : [parsed.sourceQuality.notes],
        followUpQueries:
          parsed.followUpQueries.length > 0
            ? parsed.followUpQueries
            : parsed.gaps.map((gap) => gap.suggestedFollowUpQuery).filter((query): query is string => Boolean(query))
      }
    };
  } catch (error) {
    return {
      review: fallbackReportReview("Report reviewer returned malformed JSON. Raw output was saved for inspection."),
      parseFailed: true,
      parseError: safeError(error),
      rawContent: content
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
  timeoutMs?: number;
}): Promise<ReportReviewerResult> {
  if (params.dryRun) {
    return {
      review: {
        overallAssessment: "Dry-run review: artifacts are synthetic and not suitable for real use.",
        readinessScore: -1,
        scoreLabel: "weak",
        topGaps: [],
        topRecommendations: ["Run without --dry-run before using the report."],
        sourceQualityNotes: ["No real source review was performed."],
        followUpQueries: [],
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
    timeoutMs: params.timeoutMs,
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

Readiness score: ${formatReadiness(review)}

${review.validationWarning ? `Validation warning: ${review.validationWarning}\n` : ""}

Ready for use: ${review.readyForUse ? "yes" : "no"}

${review.parseFallback ? `Report review parsing: fallback${review.rawOutputPath ? `\n\nReport review raw output: ${review.rawOutputPath}` : ""}\n` : ""}

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

Top gaps:
${(review.topGaps ?? []).map((gap) => `- ${gap}`).join("\n") || "- None listed."}

## Recommendations

${review.recommendations.map((recommendation) => `- ${recommendation}`).join("\n") || "- None listed."}
`;
}

function extractReportReviewJson(content: string): unknown {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("Model returned empty content.");
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      return JSON.parse(fenced[1]);
    }
    const objectText = firstBalancedJsonObject(trimmed);
    if (objectText) {
      return JSON.parse(objectText);
    }
    throw new Error("Could not extract a JSON object from model content.");
  }
}

function firstBalancedJsonObject(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start === -1) {
    return undefined;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }
  return undefined;
}

function normalizeReadinessScore(
  rawScore: unknown,
  rawLabel: ScoreLabel | undefined
): {
  readinessScore: ReadinessScore;
  scoreLabel: ScoreLabel;
  validationWarning?: string;
  invalidReadinessScore?: unknown;
} {
  const warnings: string[] = [];
  const parsed = numericScore(rawScore);
  let readinessScore: ReadinessScore;
  let invalidReadinessScore: unknown;
  if (rawScore === undefined) {
    readinessScore = -1;
    warnings.push("missing readinessScore; normalized conservatively");
  } else if (parsed === undefined || !isReadinessScore(parsed)) {
    readinessScore = -1;
    invalidReadinessScore = rawScore;
    warnings.push("invalid readinessScore; normalized conservatively");
  } else {
    readinessScore = parsed;
  }
  const scoreLabel = scoreLabelFor(readinessScore);
  if (rawLabel !== undefined && rawLabel !== scoreLabel) {
    warnings.push(`scoreLabel '${rawLabel}' conflicts with readinessScore; normalized to '${scoreLabel}'`);
  }
  return {
    readinessScore,
    scoreLabel,
    ...(warnings.length > 0 ? { validationWarning: warnings.join("; ") } : {}),
    ...(invalidReadinessScore !== undefined ? { invalidReadinessScore } : {})
  };
}

function numericScore(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return Number(value);
  }
  return undefined;
}

function isReadinessScore(value: number): value is ReadinessScore {
  return value === -2 || value === -1 || value === 0 || value === 1 || value === 2;
}

function scoreLabelFor(score: ReadinessScore): ScoreLabel {
  const labels: Record<ReadinessScore, ScoreLabel> = {
    [-2]: "harmful",
    [-1]: "weak",
    0: "mixed",
    1: "useful",
    2: "strong"
  };
  return labels[score];
}

function formatReadiness(review: ReportReview): string {
  if (typeof review.readinessScore === "number") {
    return `${review.readinessScore} / ${review.scoreLabel ?? scoreLabelFor(review.readinessScore)}`;
  }
  if (typeof review.qualityScore === "number") {
    return `legacy qualityScore ${review.qualityScore}`;
  }
  return "unavailable";
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 240);
}
