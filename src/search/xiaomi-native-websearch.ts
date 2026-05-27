import { normalizeAnnotation } from "../evidence/dedupe-sources.js";
import { chatWithWebSearch, extractAnnotations, normalizeXiaomiError } from "../providers/xiaomi.js";
import type { XiaomiMessage } from "../types.js";
import type { SearchProvider, SearchProviderRequest, SearchProviderResult } from "./search-provider.js";

const DISABLED_MESSAGE =
  "Xiaomi native Web Search is disabled for this Token Plan key/project/endpoint. The normal Xiaomi chat API works, but native web_search is rejected by the server. Use --search-provider opencode-web for now, or contact Xiaomi support.";

export class XiaomiNativeWebSearchProvider implements SearchProvider {
  readonly name = "xiaomi-native" as const;

  constructor(
    private readonly params: {
      apiKey: string;
      baseUrl: string;
    }
  ) {}

  async search(request: SearchProviderRequest): Promise<SearchProviderResult> {
    try {
      const messages: XiaomiMessage[] = [
        {
          role: "user",
          content: `Search the web for current sources about: ${request.query}. Return concise grounded notes.`
        }
      ];
      const response = await chatWithWebSearch({
        apiKey: this.params.apiKey,
        baseUrl: this.params.baseUrl,
        model: request.model ?? "mimo-v2.5-pro",
        maxCompletionTokens: 2000,
        timeoutMs: request.timeoutMs,
        maxKeyword: 3,
        limit: request.maxResults,
        messages
      });
      const sources = extractAnnotations(response)
        .map((annotation) => normalizeAnnotation(annotation))
        .filter((source): source is NonNullable<typeof source> => Boolean(source))
        .map((annotation) => ({
          title: annotation.title,
          url: annotation.url,
          summary: annotation.summary,
          publishedDate: annotation.publishTime,
          provider: this.name,
          query: request.query
        }));
      return {
        taskId: request.taskId,
        query: request.query,
        provider: this.name,
        sources,
        usage: {
          calls: 1
        }
      };
    } catch (error) {
      const message = normalizeXiaomiError(error);
      if (message.includes("web search tool found in the request body") && message.includes("webSearchEnabled is false")) {
        throw new Error(DISABLED_MESSAGE);
      }
      throw error;
    }
  }
}

export function isXiaomiNativeWebSearchDisabled(error: unknown): boolean {
  return normalizeXiaomiError(error).includes(DISABLED_MESSAGE);
}
