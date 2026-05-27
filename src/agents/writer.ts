import { readFile } from "node:fs/promises";
import path from "node:path";
import { chat, extractUsage } from "../providers/xiaomi.js";
import type { Critique, EvidenceFile, Plan, Source, XiaomiUsage } from "../types.js";
import { getAssistantContent } from "./json.js";

export async function runWriter(params: {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxCompletionTokens: number;
  plan: Plan;
  evidence: EvidenceFile;
  critique: Critique;
  sources: Source[];
  partial: boolean;
  dryRun: boolean;
  timeoutMs?: number;
}): Promise<{ report: string; usage?: XiaomiUsage }> {
  if (params.dryRun) {
    return { report: dryRunReport(params.plan, params.sources) };
  }

  const system = await readFile(path.resolve("src/prompts/writer.md"), "utf8");
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
            plan: params.plan,
            evidence: params.evidence,
            critique: params.critique,
            partialResearch: params.partial,
            sources: params.sources.map((source) => ({
              citationIndex: source.citationIndex,
              title: source.title,
              url: source.url,
              summary: source.summary,
              siteName: source.siteName,
              publishTime: source.publishTime
            }))
          },
          null,
          2
        )
      }
    ]
  });
  return { report: getAssistantContent(response), usage: extractUsage(response) };
}

function dryRunReport(plan: Plan, sources: Source[]): string {
  const bibliography = sources.map((source) => `[${source.citationIndex}] ${source.title ?? source.url} - ${source.url}`).join("\n");
  return `# ${plan.topic}

This is a dry-run report. It proves that the local pipeline can create artifacts without calling Xiaomi [1].

## Findings

The generated plan contains ${plan.subquestions.length} subquestions and ${plan.searchTasks.length} search tasks [1].

## Limitations

Dry-run evidence is synthetic and should not be treated as factual.

## Bibliography

${bibliography}
`;
}
