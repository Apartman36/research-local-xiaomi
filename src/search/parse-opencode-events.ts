import { parseOpenCodeWebsearchOutput } from "./parse-opencode-websearch-output.js";
import type { SearchProviderResult, SearchProviderSource, SearchProviderUsage } from "./search-provider.js";

type ParseOptions = {
  taskId: string;
  query: string;
};

type TokenTotals = NonNullable<SearchProviderUsage["tokens"]>;

export function parseOpenCodeEvents(stdout: string, options: ParseOptions): SearchProviderResult {
  const parser = new OpenCodeEventParser(options);
  for (const line of stdout.split(/\r?\n/)) {
    parser.addLine(line);
  }
  return parser.result();
}

export class OpenCodeEventParser {
  private readonly warnings: string[] = [];
  private readonly sources: SearchProviderSource[] = [];
  private readonly tokens: Required<TokenTotals> = {
    total: 0,
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0
  };
  private rawEventsCount = 0;
  private websearchCalls = 0;
  private webfetchCalls = 0;
  private sourcesExtracted = false;

  constructor(private readonly options: ParseOptions) {}

  addChunk(chunk: string): boolean {
    for (const line of chunk.split(/\r?\n/)) {
      this.addLine(line);
    }
    return this.hasSources();
  }

  addLine(line: string): boolean {
    if (!line.trim()) {
      return this.hasSources();
    }
    let event: unknown;
    try {
      event = JSON.parse(line);
      this.rawEventsCount += 1;
    } catch {
      this.warnings.push(`Skipped non-JSON OpenCode stdout line: ${line.slice(0, 120)}`);
      return this.hasSources();
    }
    if (!event || typeof event !== "object") {
      return this.hasSources();
    }
    const record = event as Record<string, unknown>;
    if (record.type === "tool_use") {
      const part = objectValue(record.part);
      const tool = stringValue(part?.tool) ?? stringValue(part?.name) ?? stringValue(record.tool) ?? stringValue(record.name);
      const state = objectValue(part?.state);
      const status = stringValue(state?.status) ?? stringValue(part?.status) ?? stringValue(record.status);
      if (tool === "websearch" && status === "completed") {
        this.websearchCalls += 1;
        const output = outputString(state?.output ?? part?.output ?? record.output);
        if (output) {
          const parsedSources = parseOpenCodeWebsearchOutput(output, { query: this.options.query });
          this.sources.push(...parsedSources);
          this.sourcesExtracted ||= parsedSources.length > 0;
        }
      } else if (tool === "webfetch" && status === "completed") {
        this.webfetchCalls += 1;
      }
    } else if (record.type === "step_finish") {
      const part = objectValue(record.part);
      const stepTokens = objectValue(part?.tokens);
      this.tokens.total += numeric(stepTokens?.total);
      this.tokens.input += numeric(stepTokens?.input);
      this.tokens.output += numeric(stepTokens?.output);
      this.tokens.reasoning += numeric(stepTokens?.reasoning);
      const cache = objectValue(stepTokens?.cache);
      this.tokens.cacheRead += numeric(cache?.read);
      this.tokens.cacheWrite += numeric(cache?.write);
    } else if (record.type === "error") {
      this.warnings.push(`OpenCode error event: ${JSON.stringify(record).slice(0, 500)}`);
    }
    return this.hasSources();
  }

  hasSources(): boolean {
    return this.sourcesExtracted;
  }

  result(extra?: { earlyExit?: boolean }): SearchProviderResult {
    return {
      taskId: this.options.taskId,
      query: this.options.query,
      provider: "opencode-web",
      sources: this.sources,
      rawEventsCount: this.rawEventsCount,
      warnings: this.warnings,
      sourcesExtracted: this.sourcesExtracted,
      earlyExit: Boolean(extra?.earlyExit),
      usage: {
        calls: 1,
        websearchCalls: this.websearchCalls,
        webfetchCalls: this.webfetchCalls,
        tokens: this.tokens
      }
    };
  }
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function outputString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }
  return undefined;
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
