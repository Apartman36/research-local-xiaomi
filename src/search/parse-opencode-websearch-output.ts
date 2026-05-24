import type { SearchProviderSource } from "./search-provider.js";

type ParseOptions = {
  query: string;
};

const MAX_SUMMARY_LENGTH = 2200;

export function parseOpenCodeWebsearchOutput(output: string, options: ParseOptions): SearchProviderSource[] {
  const cleaned = stripCodeFence(output);
  return cleaned
    .split(/\n\s*---\s*\n/g)
    .map((block) => parseBlock(block, options.query))
    .filter((source): source is SearchProviderSource => Boolean(source));
}

function parseBlock(block: string, query: string): SearchProviderSource | undefined {
  const title = field(block, "Title");
  const url = field(block, "URL");
  if (!url || !isHttpUrl(url)) {
    return undefined;
  }
  const published = field(block, "Published");
  const author = field(block, "Author");
  const highlights = section(block, "Highlights");
  return {
    title: emptyToUndefined(title),
    url,
    publishedDate: normalizeOptional(published),
    author: normalizeOptional(author),
    summary: normalizeSummary(highlights),
    provider: "opencode-web",
    query
  };
}

function field(block: string, name: string): string | undefined {
  const match = block.match(new RegExp(`^${name}:\\s*(.+?)\\s*$`, "im"));
  return match?.[1]?.trim();
}

function section(block: string, name: string): string | undefined {
  const match = block.match(new RegExp(`^${name}:\\s*\\n([\\s\\S]*)$`, "im"));
  return match?.[1];
}

function normalizeOptional(value: string | undefined): string | undefined {
  const trimmed = emptyToUndefined(value);
  if (!trimmed || /^n\/a$/i.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function normalizeSummary(value: string | undefined): string | undefined {
  const normalized = emptyToUndefined(value?.replace(/\[\.\.\.\](\s*\[\.\.\.\])+/g, "[...]").replace(/\s+/g, " "));
  if (!normalized) {
    return undefined;
  }
  return normalized.length > MAX_SUMMARY_LENGTH ? `${normalized.slice(0, MAX_SUMMARY_LENGTH).trim()}...` : normalized;
}

function emptyToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function stripCodeFence(value: string): string {
  return value
    .trim()
    .replace(/^```(?:json|markdown|md|text)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

