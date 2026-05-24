import { normalizeAnnotation } from "../evidence/dedupe-sources.js";
import type { NormalizedAnnotation, XiaomiResponse, XiaomiUsage } from "../types.js";

export type XiaomiChatParams = {
  apiKey: string;
  baseUrl: string;
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  maxCompletionTokens: number;
  temperature?: number;
  topP?: number;
  timeoutMs?: number;
};

export type XiaomiWebSearchParams = XiaomiChatParams & {
  maxKeyword: number;
  limit: number;
  forceSearch?: boolean;
};

const RETRY_DELAYS_MS = [1000, 4000, 15000];

export async function chat(params: XiaomiChatParams): Promise<XiaomiResponse> {
  return postChat(params, {});
}

export async function chatWithWebSearch(params: XiaomiWebSearchParams): Promise<XiaomiResponse> {
  return postChat(params, {
    tools: [
      {
        type: "web_search",
        max_keyword: params.maxKeyword,
        force_search: params.forceSearch ?? true,
        limit: params.limit
      }
    ],
    tool_choice: "auto"
  });
}

export function extractUsage(response: XiaomiResponse): XiaomiUsage | undefined {
  return response.usage;
}

export function extractAnnotations(response: XiaomiResponse): NormalizedAnnotation[] {
  const annotations = response.choices?.flatMap((choice) => choice.message?.annotations ?? []) ?? [];
  const normalized: NormalizedAnnotation[] = [];
  for (const annotation of annotations) {
    const source = annotationToSource(annotation);
    if (source) {
      normalized.push(source);
    }
  }
  return normalized;
}

export function normalizeXiaomiError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown Xiaomi API error";
  }
}

async function postChat(params: XiaomiChatParams, extraPayload: Record<string, unknown>): Promise<XiaomiResponse> {
  const payload = {
    model: params.model,
    messages: params.messages,
    max_completion_tokens: params.maxCompletionTokens,
    temperature: params.temperature ?? 1.0,
    top_p: params.topP ?? 0.95,
    stream: false,
    thinking: { type: "disabled" },
    ...extraPayload
  };

  return retry(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? 120_000);
    try {
      const response = await fetch(`${params.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": params.apiKey
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const text = await response.text();
      let data: XiaomiResponse;
      try {
        data = text ? (JSON.parse(text) as XiaomiResponse) : {};
      } catch {
        throw new Error(`Malformed JSON from Xiaomi API: ${text.slice(0, 500)}`);
      }

      if (!response.ok) {
        const suffix = response.status === 401 ? " Check XIAOMI_MIMO_API_KEY." : "";
        throw new Error(`Xiaomi API HTTP ${response.status}: ${JSON.stringify(data.error ?? data).slice(0, 1000)}${suffix}`);
      }
      if (!data.choices?.[0]?.message) {
        throw new Error("Xiaomi API response is missing choices[0].message.");
      }
      return data;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Xiaomi API request timed out after ${params.timeoutMs ?? 120_000} ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  });
}

async function retry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const message = normalizeXiaomiError(error);
      if (message.includes("HTTP 401") || message.includes("HTTP 400")) {
        break;
      }
      if (attempt < RETRY_DELAYS_MS.length - 1) {
        await sleep(RETRY_DELAYS_MS[attempt] ?? 1000);
      }
    }
  }
  throw lastError;
}

function annotationToSource(annotation: unknown): NormalizedAnnotation | undefined {
  if (!annotation || typeof annotation !== "object") {
    return undefined;
  }
  const record = annotation as Record<string, unknown>;
  const urlCitation = objectValue(record.url_citation);
  const container = urlCitation ?? record;
  const url = stringValue(container.url) ?? stringValue(container.uri) ?? stringValue(container.href);
  return normalizeAnnotation({
    url,
    title: stringValue(container.title) ?? stringValue(record.title),
    summary: stringValue(container.summary) ?? stringValue(container.content) ?? stringValue(record.summary),
    siteName: stringValue(container.site_name) ?? stringValue(container.siteName) ?? stringValue(record.site_name),
    publishTime: stringValue(container.publish_time) ?? stringValue(container.publishTime) ?? stringValue(record.publish_time)
  });
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
