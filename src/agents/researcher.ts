import { normalizeUrl } from "../evidence/normalize-url.js";
import type { SearchProvider, SearchProviderResult } from "../search/search-provider.js";
import type { EvidenceClaim, Finding, NormalizedAnnotation, ResearchProfile, SearchTask, XiaomiUsage } from "../types.js";

export async function runResearchTask(params: {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxCompletionTokens: number;
  profile: ResearchProfile;
  task: SearchTask;
  searchProvider: SearchProvider;
  dryRun: boolean;
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
      model: params.model
    });
    const annotations = providerResult.sources.map(sourceToAnnotation);
    const canonicalUrls = annotations.map((annotation) => normalizeUrl(annotation.url));
    const claims: EvidenceClaim[] = annotations.slice(0, 5).map((annotation, index) => ({
      id: `${params.task.id}-C${String(index + 1).padStart(3, "0")}`,
      subquestionId: params.task.subquestionId,
      taskId: params.task.id,
      text: evidenceClaimText(params.task.query, annotation),
      sourceIds: [canonicalUrls[index] ?? annotation.canonicalUrl],
      confidence: "medium"
    }));
    return {
      taskId: params.task.id,
      subquestionId: params.task.subquestionId,
      query: params.task.query,
      assistantSynthesis: synthesizeProviderResult(params.task.query, annotations),
      annotations,
      claims,
      providerResult
    };
  } catch (error) {
    return {
      taskId: params.task.id,
      subquestionId: params.task.subquestionId,
      query: params.task.query,
      assistantSynthesis: "",
      annotations: [],
      claims: [],
      error: error instanceof Error ? error.message : String(error)
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
    providerResult
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

function siteNameFromUrl(value: string): string | undefined {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}
