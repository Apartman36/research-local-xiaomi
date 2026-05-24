import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { normalizeUrl } from "../evidence/normalize-url.js";
import { chatWithWebSearch, extractAnnotations, extractUsage, normalizeXiaomiError } from "../providers/xiaomi.js";
import type { EvidenceClaim, Finding, ResearchProfile, SearchTask, XiaomiUsage } from "../types.js";
import { extractJsonObject, getAssistantContent } from "./json.js";

const researcherSchema = z.object({
  assistantSynthesis: z.string().default(""),
  claims: z
    .array(
      z.object({
        text: z.string(),
        confidence: z.enum(["low", "medium", "high"]).default("medium")
      })
    )
    .default([])
});

export async function runResearchTask(params: {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxCompletionTokens: number;
  profile: ResearchProfile;
  task: SearchTask;
  dryRun: boolean;
}): Promise<Finding> {
  if (params.dryRun) {
    return dryRunFinding(params.task);
  }

  try {
    const system = await readFile(path.resolve("src/prompts/researcher.md"), "utf8");
    const response = await chatWithWebSearch({
      apiKey: params.apiKey,
      baseUrl: params.baseUrl,
      model: params.model,
      maxCompletionTokens: params.maxCompletionTokens,
      maxKeyword: params.profile.maxKeyword,
      limit: params.profile.limit,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: JSON.stringify(
            {
              task: params.task,
              instruction: "Run web search and return grounded claims as JSON."
            },
            null,
            2
          )
        }
      ]
    });
    const content = getAssistantContent(response);
    const parsed = researcherSchema.parse(extractJsonObject(content));
    const annotations = extractAnnotations(response);
    const canonicalUrls = annotations.map((annotation) => normalizeUrl(annotation.url));
    const claims: EvidenceClaim[] = parsed.claims.map((claim, index) => ({
      id: `${params.task.id}-C${String(index + 1).padStart(3, "0")}`,
      subquestionId: params.task.subquestionId,
      taskId: params.task.id,
      text: claim.text,
      sourceIds: canonicalUrls,
      confidence: claim.confidence
    }));
    return {
      taskId: params.task.id,
      subquestionId: params.task.subquestionId,
      query: params.task.query,
      assistantSynthesis: parsed.assistantSynthesis || content,
      annotations,
      claims,
      usage: extractUsage(response)
    };
  } catch (error) {
    return {
      taskId: params.task.id,
      subquestionId: params.task.subquestionId,
      query: params.task.query,
      assistantSynthesis: "",
      annotations: [],
      claims: [],
      error: normalizeXiaomiError(error)
    };
  }
}

export function findingUsage(finding: Finding): XiaomiUsage | undefined {
  return finding.usage;
}

function dryRunFinding(task: SearchTask): Finding {
  const url = task.focus === "github" ? "https://github.com/example/research-tool" : "https://example.com/research-source";
  return {
    taskId: task.id,
    subquestionId: task.subquestionId,
    query: task.query,
    assistantSynthesis: `Dry-run synthesis for ${task.query}.`,
    annotations: [
      {
        url,
        canonicalUrl: normalizeUrl(url),
        title: "Dry-run source",
        summary: "Synthetic source used only in dry-run mode.",
        siteName: task.focus === "github" ? "GitHub" : "Example"
      }
    ],
    claims: [
      {
        id: `${task.id}-C001`,
        subquestionId: task.subquestionId,
        taskId: task.id,
        text: `Dry-run evidence claim for ${task.query}.`,
        sourceIds: [normalizeUrl(url)],
        confidence: "low"
      }
    ]
  };
}
