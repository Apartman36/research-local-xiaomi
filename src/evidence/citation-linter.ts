import type { CitationLintResult, Source } from "../types.js";

const CITATION_REGEX = /\[(\d+)\]/g;

export function lintCitations(markdown: string, sources: Source[]): CitationLintResult {
  const valid = new Set(sources.map((source) => source.citationIndex));
  const cited = new Set<number>();
  const unknown = new Set<number>();
  for (const match of markdown.matchAll(CITATION_REGEX)) {
    const value = Number(match[1]);
    if (!Number.isInteger(value)) {
      continue;
    }
    cited.add(value);
    if (!valid.has(value)) {
      unknown.add(value);
    }
  }
  return {
    ok: unknown.size === 0,
    citedNumbers: [...cited].sort((a, b) => a - b),
    unknownNumbers: [...unknown].sort((a, b) => a - b),
    sourcesUsed: [...cited].filter((value) => valid.has(value)).length
  };
}
