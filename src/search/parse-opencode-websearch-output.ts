import type { SearchProviderSource } from "./search-provider.js";

type ParseOptions = {
  query: string;
};

const MAX_SUMMARY_LENGTH = 2200;

export function parseOpenCodeWebsearchOutput(output: string, options: ParseOptions): SearchProviderSource[] {
  const cleaned = stripCodeFence(output);
  const jsonSources = parseJsonSources(cleaned, options.query);
  if (jsonSources.length > 0) {
    return jsonSources;
  }
  return cleaned
    .split(/\n\s*---\s*\n/g)
    .map((block) => parseBlock(block, options.query))
    .filter((source): source is SearchProviderSource => Boolean(source));
}

function parseJsonSources(output: string, query: string): SearchProviderSource[] {
  try {
    const parsed = JSON.parse(output);
    const candidates = Array.isArray(parsed) ? parsed : arrayValue((parsed as Record<string, unknown>).sources) ?? arrayValue((parsed as Record<string, unknown>).results) ?? [];
    return candidates.map((candidate) => sourceFromJson(candidate, query)).filter((source): source is SearchProviderSource => Boolean(source));
  } catch {
    return [];
  }
}

function sourceFromJson(value: unknown, query: string): SearchProviderSource | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const url = stringValue(record.url) ?? stringValue(record.link);
  if (!url || !isHttpUrl(url)) {
    return undefined;
  }
  return {
    title: stringValue(record.title),
    url,
    publishedDate: stringValue(record.publishedDate) ?? stringValue(record.published) ?? stringValue(record.date),
    author: stringValue(record.author),
    summary: normalizeSummary(stringValue(record.summary) ?? stringValue(record.snippet) ?? stringValue(record.text)),
    provider: "opencode-web",
    query
  };
}

function arrayValue(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
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
