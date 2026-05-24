import { parseOpenCodeWebsearchOutput } from "./parse-opencode-websearch-output.js";
import type { SearchProviderResult, SearchProviderSource, SearchProviderUsage } from "./search-provider.js";

type ParseOptions = {
  taskId: string;
  query: string;
};

type TokenTotals = NonNullable<SearchProviderUsage["tokens"]>;

export function parseOpenCodeEvents(stdout: string, options: ParseOptions): SearchProviderResult {
  const warnings: string[] = [];
  const sources: SearchProviderSource[] = [];
  const tokens: Required<TokenTotals> = {
    total: 0,
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0
  };
  let rawEventsCount = 0;
  let websearchCalls = 0;
  let webfetchCalls = 0;

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    let event: unknown;
    try {
      event = JSON.parse(line);
      rawEventsCount += 1;
    } catch {
      warnings.push(`Skipped non-JSON OpenCode stdout line: ${line.slice(0, 120)}`);
      continue;
    }
    if (!event || typeof event !== "object") {
      continue;
    }
    const record = event as Record<string, unknown>;
    if (record.type === "tool_use") {
      const part = objectValue(record.part);
      const tool = stringValue(part?.tool);
      const state = objectValue(part?.state);
      const status = stringValue(state?.status);
      if (tool === "websearch" && status === "completed") {
        websearchCalls += 1;
        const output = stringValue(state?.output);
        if (output) {
          sources.push(...parseOpenCodeWebsearchOutput(output, { query: options.query }));
        }
      } else if (tool === "webfetch" && status === "completed") {
        webfetchCalls += 1;
      }
    } else if (record.type === "step_finish") {
      const part = objectValue(record.part);
      const stepTokens = objectValue(part?.tokens);
      tokens.total += numeric(stepTokens?.total);
      tokens.input += numeric(stepTokens?.input);
      tokens.output += numeric(stepTokens?.output);
      tokens.reasoning += numeric(stepTokens?.reasoning);
      const cache = objectValue(stepTokens?.cache);
      tokens.cacheRead += numeric(cache?.read);
      tokens.cacheWrite += numeric(cache?.write);
    } else if (record.type === "error") {
      warnings.push(`OpenCode error event: ${JSON.stringify(record).slice(0, 500)}`);
    }
  }

  return {
    taskId: options.taskId,
    query: options.query,
    provider: "opencode-web",
    sources,
    rawEventsCount,
    warnings,
    usage: {
      calls: 1,
      websearchCalls,
      webfetchCalls,
      tokens
    }
  };
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

