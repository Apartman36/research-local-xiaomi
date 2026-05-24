import type { Source } from "../types.js";

export function rankSources(sources: Source[]): Source[] {
  return [...sources].sort((a, b) => score(b) - score(a) || a.canonicalUrl.localeCompare(b.canonicalUrl));
}

function score(source: Source): number {
  let value = source.seenCount * 10;
  if (source.publishTime) {
    const timestamp = Date.parse(source.publishTime);
    if (!Number.isNaN(timestamp)) {
      const ageDays = Math.max(0, (Date.now() - timestamp) / 86_400_000);
      value += Math.max(0, 8 - ageDays / 365);
    }
  }
  if (source.siteName?.toLowerCase().includes("github") || source.canonicalUrl.includes("github.com")) {
    value += source.focus === "github" ? 8 : 2;
  }
  if (source.title) {
    value += 2;
  }
  if (source.summary) {
    value += 1;
  }
  return value;
}
