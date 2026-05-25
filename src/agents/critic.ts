import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { chat, extractUsage } from "../providers/xiaomi.js";
import type { Critique, EvidenceFile, Plan, ResearchFocus, Source, XiaomiUsage } from "../types.js";
import { extractJsonObject, getAssistantContent } from "./json.js";

const critiqueSchema = z.object({
  summary: z.string(),
  weakAreas: z.array(z.string()).default([]),
  missingCoverage: z.array(z.string()).default([]),
  duplicateEvidence: z.array(z.string()).default([]),
  needsFollowUp: z.boolean().default(false),
  followUpTasks: z
    .array(
      z.object({
        id: z.string(),
        subquestionId: z.string().nullable().optional().transform((value) => value ?? "SQ000"),
        query: z.string(),
        rationale: z.string().optional(),
        depth: z.number().int().positive().default(2),
        focus: z.enum(["web", "github"])
      })
    )
    .default([])
});

export type CriticResult = {
  critique: Critique;
  usage?: XiaomiUsage;
  parseFailed?: boolean;
  parseError?: string;
};

export const fallbackCritique: Critique = {
  summary: "Critic returned malformed JSON; follow-up planning was skipped.",
  weakAreas: ["Critic returned malformed JSON; follow-up planning was skipped."],
  missingCoverage: [],
  duplicateEvidence: [],
  followUpTasks: [],
  needsFollowUp: false
};

export function parseCritiqueContent(content: string): CriticResult {
  try {
    const critique = critiqueSchema.parse(extractJsonObject(content));
    return { critique };
  } catch (error) {
    return {
      critique: fallbackCritique,
      parseFailed: true,
      parseError: safeParseError(error)
    };
  }
}

export async function runCritic(params: {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxCompletionTokens: number;
  plan: Plan;
  evidence: EvidenceFile;
  sources: Source[];
  focus: ResearchFocus;
  dryRun: boolean;
}): Promise<CriticResult> {
  if (params.dryRun) {
    return {
      critique: {
        summary: "Dry-run critique: evidence is synthetic and should not be used as a real research result.",
        weakAreas: ["Dry-run mode did not call Xiaomi Web Search."],
        missingCoverage: [],
        duplicateEvidence: [],
        followUpTasks: [],
        needsFollowUp: false
      }
    };
  }

  const system = await readFile(path.resolve("src/prompts/critic.md"), "utf8");
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
            plan: params.plan,
            evidenceSummary: params.evidence,
            sources: params.sources.slice(0, 250),
            focus: params.focus
          },
          null,
          2
        )
      }
    ]
  });
  const parsed = parseCritiqueContent(getAssistantContent(response));
  return { ...parsed, usage: extractUsage(response) };
}

function safeParseError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 240);
}
