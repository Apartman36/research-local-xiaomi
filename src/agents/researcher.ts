import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { normalizeUrl } from "../evidence/normalize-url.js";
import { chat, extractUsage } from "../providers/xiaomi.js";
import type { SearchProvider, SearchProviderResult } from "../search/search-provider.js";
import type {
  EvidenceClaim,
  Finding,
  NormalizedAnnotation,
  ResearcherMode,
  ResearchProfile,
  SearchTask,
  XiaomiUsage
} from "../types.js";
import { extractJsonObject, getAssistantContent } from "./json.js";

const optionalStringArray = z.array(z.string()).nullish().transform((value) => value ?? undefined);
const optionalNumberArray = z.array(z.coerce.number().int()).nullish().transform((value) => value ?? undefined);

const researcherClaimSchema = z.object({
  claim: z.string().optional(),
  text: z.string().optional(),
  sourceUrls: optionalStringArray,
  sourceIds: optionalStringArray,
  sourceIndexes: optionalNumberArray,
  sourceIndices: optionalNumberArray,
  confidence: z.enum(["high", "medium", "low"]).default("medium"),
  claimType: z
    .enum(["fact", "capability", "limitation", "comparison", "recommendation", "risk", "unknown"])
    .optional(),
  limitations: z.string().nullish().transform((value) => value ?? undefined)
});

const researcherSchema = z.object({
  assistantSynthesis: z.string().min(1),
  claims: z.array(researcherClaimSchema).default([]),
  warnings: z.array(z.string()).nullish().transform((value) => value ?? [])
});

export type ResearcherParseResult = {
  assistantSynthesis: string;
  claims: EvidenceClaim[];
  warnings: string[];
  unmatchedSourceRefs: string[];
  parseFailed?: boolean;
  parseError?: string;
};

export async function runResearchTask(params: {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxCompletionTokens: number;
  profile: ResearchProfile;
  task: SearchTask;
  searchProvider: SearchProvider;
  opencodeTimeoutMs?: number;
  researcherMode: ResearcherMode;
  dryRun: boolean;
  onEvent?: (type: string, metadata?: Record<string, unknown>) => Promise<void> | void;
}): Promise<Finding & { providerResult?: SearchProviderResult }> {
  if (params.dryRun) {
    return dryRunFinding(params.task, params.searchProvider.name);
  }

  try {
    const providerResult = await params.searchProvider.search({
      taskId: params.task.id,
      query: params.task.query,
      focus: params.task.focus,
      maxResults: params.profile.limit,
      model: params.model,
      timeoutMs: params.opencodeTimeoutMs
    });
    const limitedProviderResult = {
      ...providerResult,
      sources: providerResult.sources.slice(0, params.profile.limit)
    };
    const annotations = limitedProviderResult.sources.map(sourceToAnnotation);

    if (params.researcherMode === "mechanical") {
      return {
        ...mechanicalFinding(params.task, annotations),
        extractionMode: "mechanical",
        providerResult: limitedProviderResult
      };
    }

    const system = await readFile(path.resolve("src/prompts/researcher.md"), "utf8");
    try {
      await emit(params.onEvent, "researcher_extraction_started", {
        taskId: params.task.id,
        sourceCount: annotations.length
      });
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
                task: {
                  id: params.task.id,
                  subquestionId: params.task.subquestionId,
                  query: params.task.query,
                  focus: params.task.focus,
                  rationale: params.task.rationale
                },
                sourceSnippets: annotations.map((annotation, index) => ({
                  index: index + 1,
                  url: annotation.url,
                  canonicalUrl: annotation.canonicalUrl,
                  title: annotation.title,
                  summary: annotation.summary,
                  siteName: annotation.siteName,
                  publishTime: annotation.publishTime
                }))
              },
              null,
              2
            )
          }
        ]
      });
      const parsed = parseResearcherContent(getAssistantContent(response), { task: params.task, annotations });
      const usage = extractUsage(response);
      for (const ref of parsed.unmatchedSourceRefs) {
        await emit(params.onEvent, "researcher_claim_source_unmatched", { taskId: params.task.id, sourceRef: ref });
      }
      if (parsed.parseFailed || parsed.claims.length === 0) {
        await emit(params.onEvent, "researcher_parse_failed", {
          taskId: params.task.id,
          error: parsed.parseError ?? "Researcher returned no usable grounded claims."
        });
        await emit(params.onEvent, "researcher_fallback_used", {
          taskId: params.task.id,
          reason: "parse_failed"
        });
        return {
          ...mechanicalFinding(params.task, annotations),
          extractionMode: "fallback",
          warnings: parsed.warnings,
          parseFailed: true,
          parseError: parsed.parseError ?? "Researcher returned no usable grounded claims.",
          unmatchedSourceRefs: parsed.unmatchedSourceRefs,
          usage,
          providerResult: limitedProviderResult
        };
      }
      await emit(params.onEvent, "researcher_extraction_completed", {
        taskId: params.task.id,
        claims: parsed.claims.length,
        sourceCount: annotations.length,
        tokens: usage?.total_tokens
      });
      return {
        taskId: params.task.id,
        subquestionId: params.task.subquestionId,
        query: params.task.query,
        assistantSynthesis: parsed.assistantSynthesis,
        annotations,
        claims: parsed.claims,
        extractionMode: "xiaomi",
        warnings: parsed.warnings,
        unmatchedSourceRefs: parsed.unmatchedSourceRefs,
        usage,
        providerResult: limitedProviderResult
      };
    } catch (error) {
      await emit(params.onEvent, "researcher_extraction_failed", {
        taskId: params.task.id,
        error: safeError(error)
      });
      await emit(params.onEvent, "researcher_fallback_used", {
        taskId: params.task.id,
        reason: "extraction_failed"
      });
      return {
        ...mechanicalFinding(params.task, annotations),
        extractionMode: "fallback",
        extractionError: safeError(error),
        providerResult: limitedProviderResult
      };
    }
  } catch (error) {
    return {
      taskId: params.task.id,
      subquestionId: params.task.subquestionId,
      query: params.task.query,
      assistantSynthesis: "",
      annotations: [],
      claims: [],
      error: safeError(error)
    };
  }
}

export function parseResearcherContent(
  content: string,
  params: { task: SearchTask; annotations: NormalizedAnnotation[] }
): ResearcherParseResult {
  try {
    const parsed = researcherSchema.parse(extractJsonObject(content));
    const unmatchedSourceRefs: string[] = [];
    const claims = parsed.claims
      .map((claim, index): EvidenceClaim | undefined => {
        const text = (claim.claim ?? claim.text ?? "").trim();
        if (!text) {
          return undefined;
        }
        const unmatchedBefore = unmatchedSourceRefs.length;
        const sourceIds = resolveClaimSources(claim, params.annotations, unmatchedSourceRefs);
        if (sourceIds.length === 0) {
          return undefined;
        }
        const limitations = claim.limitations?.trim();
        return {
          id: `${params.task.id}-C${String(index + 1).padStart(3, "0")}`,
          subquestionId: params.task.subquestionId,
          taskId: params.task.id,
          text: limitations ? `${text} Limitation: ${limitations}` : text,
          sourceIds,
          confidence: unmatchedSourceRefs.length > unmatchedBefore ? "low" : claim.confidence
        };
      })
      .filter((claim): claim is EvidenceClaim => Boolean(claim));

    return {
      assistantSynthesis: parsed.assistantSynthesis,
      claims,
      warnings: parsed.warnings,
      unmatchedSourceRefs
    };
  } catch (error) {
    return {
      assistantSynthesis: "",
      claims: [],
      warnings: [],
      unmatchedSourceRefs: [],
      parseFailed: true,
      parseError: safeError(error)
    };
  }
}

export function findingUsage(finding: Finding): XiaomiUsage | undefined {
  return finding.usage;
}

function dryRunFinding(task: SearchTask, provider: string): Finding & { providerResult: SearchProviderResult } {
  const url = task.focus === "github" ? "https://github.com/example/research-tool" : "https://example.com/research-source";
  const providerResult: SearchProviderResult = {
    taskId: task.id,
    query: task.query,
    provider: provider === "xiaomi-native" ? "xiaomi-native" : "opencode-web",
    sources: [
      {
        title: "Dry-run source",
        url,
        summary: "Synthetic source used only in dry-run mode.",
        provider: provider === "xiaomi-native" ? "xiaomi-native" : "opencode-web",
        query: task.query
      }
    ],
    usage: provider === "opencode-web" ? { calls: 0, websearchCalls: 0, webfetchCalls: 0 } : { calls: 0 }
  };
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
    ],
    extractionMode: "mechanical",
    providerResult
  };
}

function mechanicalFinding(task: SearchTask, annotations: NormalizedAnnotation[]): Finding {
  const canonicalUrls = annotations.map((annotation) => normalizeUrl(annotation.url));
  const claims: EvidenceClaim[] = annotations.slice(0, 5).map((annotation, index) => ({
    id: `${task.id}-C${String(index + 1).padStart(3, "0")}`,
    subquestionId: task.subquestionId,
    taskId: task.id,
    text: evidenceClaimText(task.query, annotation),
    sourceIds: [canonicalUrls[index] ?? annotation.canonicalUrl],
    confidence: "medium"
  }));
  return {
    taskId: task.id,
    subquestionId: task.subquestionId,
    query: task.query,
    assistantSynthesis: synthesizeProviderResult(task.query, annotations),
    annotations,
    claims
  };
}

function sourceToAnnotation(source: SearchProviderResult["sources"][number]): NormalizedAnnotation {
  return {
    url: source.url,
    canonicalUrl: normalizeUrl(source.url),
    title: source.title,
    summary: source.summary,
    siteName: siteNameFromUrl(source.url),
    publishTime: source.publishedDate
  };
}

function synthesizeProviderResult(query: string, annotations: NormalizedAnnotation[]): string {
  if (annotations.length === 0) {
    return `No sources were returned for ${query}.`;
  }
  return `Found ${annotations.length} source(s) for ${query}: ${annotations
    .slice(0, 5)
    .map((annotation) => annotation.title ?? annotation.url)
    .join("; ")}.`;
}

function evidenceClaimText(query: string, annotation: NormalizedAnnotation): string {
  const title = annotation.title ?? annotation.url;
  const summary = annotation.summary ? ` ${annotation.summary}` : "";
  return `Source "${title}" provides evidence relevant to "${query}".${summary}`.slice(0, 1200);
}

function resolveClaimSources(
  claim: z.infer<typeof researcherClaimSchema>,
  annotations: NormalizedAnnotation[],
  unmatchedSourceRefs: string[]
): string[] {
  const byUrl = new Map<string, string>();
  for (const annotation of annotations) {
    byUrl.set(normalizeUrl(annotation.url), annotation.canonicalUrl);
    byUrl.set(annotation.url, annotation.canonicalUrl);
    byUrl.set(annotation.canonicalUrl, annotation.canonicalUrl);
  }

  const sourceIds: string[] = [];
  for (const ref of [...(claim.sourceUrls ?? []), ...(claim.sourceIds ?? [])]) {
    const canonical = byUrl.get(ref) ?? byUrl.get(normalizeUrl(ref));
    if (canonical) {
      sourceIds.push(canonical);
    } else {
      unmatchedSourceRefs.push(ref);
    }
  }
  for (const index of [...(claim.sourceIndexes ?? []), ...(claim.sourceIndices ?? [])]) {
    const annotation = annotations[index - 1] ?? annotations[index];
    if (annotation) {
      sourceIds.push(annotation.canonicalUrl);
    } else {
      unmatchedSourceRefs.push(String(index));
    }
  }
  return [...new Set(sourceIds)];
}

function siteNameFromUrl(value: string): string | undefined {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 240);
}

async function emit(
  onEvent: ((type: string, metadata?: Record<string, unknown>) => Promise<void> | void) | undefined,
  type: string,
  metadata: Record<string, unknown>
): Promise<void> {
  await onEvent?.(type, metadata);
}
