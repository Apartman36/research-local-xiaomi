import type { ResearchFocus, SearchProviderName } from "../types.js";

export type SearchProviderRequest = {
  taskId: string;
  query: string;
  focus: ResearchFocus;
  maxResults: number;
  model?: string;
  timeoutMs?: number;
};

export type SearchProviderSource = {
  title?: string;
  url: string;
  summary?: string;
  publishedDate?: string;
  author?: string;
  provider: SearchProviderName;
  query: string;
};

export type SearchProviderUsage = {
  calls: number;
  websearchCalls?: number;
  webfetchCalls?: number;
  tokensUnavailable?: boolean;
  tokens?: {
    total?: number;
    input?: number;
    output?: number;
    reasoning?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
};

export type SearchProviderResult = {
  taskId: string;
  query: string;
  provider: SearchProviderName;
  sources: SearchProviderSource[];
  usage?: SearchProviderUsage;
  rawEventsCount?: number;
  warnings?: string[];
  sourcesExtracted?: boolean;
  earlyExit?: boolean;
};

export interface SearchProvider {
  readonly name: SearchProviderName;
  search(request: SearchProviderRequest): Promise<SearchProviderResult>;
}

export const DEFAULT_OPENCODE_MODEL = "xiaomi-token-plan-sgp/mimo-v2.5-pro";
