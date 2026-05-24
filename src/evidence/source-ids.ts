import type { Source } from "../types.js";

export function assignSourceIds(sources: Omit<Source, "id" | "citationIndex">[]): Source[] {
  return sources.map((source, index) => ({
    ...source,
    id: `S${String(index + 1).padStart(4, "0")}`,
    citationIndex: index + 1
  }));
}

export function sourceIdByCanonicalUrl(sources: Source[]): Map<string, string> {
  return new Map(sources.map((source) => [source.canonicalUrl, source.id]));
}

export function citationIndexBySourceId(sources: Source[]): Map<string, number> {
  return new Map(sources.map((source) => [source.id, source.citationIndex]));
}
