import type { Finding, NormalizedAnnotation, ResearchFocus, Source } from "../types.js";
import { normalizeUrl } from "./normalize-url.js";
import { rankSources } from "./rank-sources.js";
import { assignSourceIds } from "./source-ids.js";

type SourceSeed = Omit<Source, "id" | "citationIndex">;

export function dedupeSources(findings: Finding[], focus?: ResearchFocus): Source[] {
  const byUrl = new Map<string, SourceSeed>();

  for (const finding of findings) {
    for (const annotation of finding.annotations) {
      const canonicalUrl = annotation.canonicalUrl || normalizeUrl(annotation.url);
      const existing = byUrl.get(canonicalUrl);
      if (existing) {
        existing.seenCount += 1;
        existing.title ||= annotation.title;
        existing.summary ||= annotation.summary;
        existing.siteName ||= annotation.siteName;
        existing.publishTime ||= annotation.publishTime;
        continue;
      }
      byUrl.set(canonicalUrl, {
        url: annotation.url,
        canonicalUrl,
        title: annotation.title,
        summary: annotation.summary,
        siteName: annotation.siteName,
        publishTime: annotation.publishTime,
        firstSeenInTaskId: finding.taskId,
        seenCount: 1,
        focus
      });
    }
  }

  return assignSourceIds(rankSources([...byUrl.values()] as Source[]));
}

export function normalizeAnnotation(input: Partial<NormalizedAnnotation> & { url?: string }): NormalizedAnnotation | undefined {
  if (!input.url) {
    return undefined;
  }
  return {
    url: input.url,
    canonicalUrl: normalizeUrl(input.url),
    title: input.title,
    summary: input.summary,
    siteName: input.siteName,
    publishTime: input.publishTime
  };
}
