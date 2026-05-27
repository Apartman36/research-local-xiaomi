import { spawn, type ChildProcess } from "node:child_process";
import { OpenCodeEventParser } from "./parse-opencode-events.js";
import type { SearchProvider, SearchProviderRequest, SearchProviderResult } from "./search-provider.js";

export class OpenCodeWebSearchProvider implements SearchProvider {
  readonly name = "opencode-web" as const;

  constructor(private readonly model?: string) {}

  async search(request: SearchProviderRequest): Promise<SearchProviderResult> {
    const prompt = buildPrompt(request);
    const args = ["run", "--format", "json"];
    const model = this.model ?? process.env.OPENCODE_MODEL;
    if (model) {
      args.push("--model", model);
    }
    args.push(prompt);

    return runOpenCodeWithRetries({
      args,
      timeoutMs: request.timeoutMs ?? 180_000,
      request,
      runner: runOpenCode
    });
  }
}

export type OpenCodeAttemptRunner = (
  args: string[],
  timeoutMs: number,
  request: SearchProviderRequest,
  attempt: number
) => Promise<SearchProviderResult>;

export async function runOpenCodeWithRetries(params: {
  args: string[];
  timeoutMs: number;
  request: SearchProviderRequest;
  runner?: OpenCodeAttemptRunner;
  retryDelaysMs?: number[];
}): Promise<SearchProviderResult> {
  const runner = params.runner ?? runOpenCode;
  const retries = clampRetries(params.request.retries);
  const maxAttempts = retries + 1;
  const retryDelaysMs = params.retryDelaysMs ?? [1000, 3000];
  let failures = 0;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await emit(params.request, "opencode_search_attempt_started", {
      taskId: params.request.taskId,
      query: params.request.query,
      attempt,
      maxAttempts
    });
    try {
      const result = await runner(params.args, params.timeoutMs, params.request, attempt);
      if (result.sources.length > 0) {
        return withRetryUsage(result, { attempts: attempt, failures, lastError });
      }
      lastError = new Error("OpenCode websearch returned zero sources.");
      failures += 1;
    } catch (error) {
      lastError = normalizeOpenCodeError(error);
      if (isMissingBinaryError(error)) {
        throw lastError;
      }
      failures += 1;
    }

    await emit(params.request, "opencode_search_attempt_failed", {
      taskId: params.request.taskId,
      query: params.request.query,
      attempt,
      maxAttempts,
      error: safeError(lastError)
    });

    if (attempt < maxAttempts) {
      const delayMs = retryDelaysMs[Math.min(attempt - 1, retryDelaysMs.length - 1)] ?? 3000;
      await emit(params.request, "opencode_search_retry", {
        taskId: params.request.taskId,
        query: params.request.query,
        attempt,
        maxAttempts,
        delayMs,
        error: safeError(lastError)
      });
      await delay(delayMs);
    }
  }

  throw new Error(
    `OpenCode websearch failed after ${maxAttempts} attempts (${retries} retries). Last error: ${safeError(lastError)}`
  );
}

export function buildPrompt(request: SearchProviderRequest): string {
  const base = `Use websearch exactly once for this query: ${request.query}. Return only ${request.maxResults} sources with title, URL, and short summary. Do not write files. Do not use bash. Do not use subagents. Do not use the task tool.`;
  if (request.focus === "github") {
    return `${base} Prefer GitHub repositories, READMEs, docs, examples, issues, and implementation details.`;
  }
  return base;
}

function runOpenCode(args: string[], timeoutMs: number, request: SearchProviderRequest): Promise<SearchProviderResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("opencode", args, {
      cwd: process.cwd(),
      env: { ...process.env, OPENCODE_ENABLE_EXA: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    const parser = new OpenCodeEventParser({ taskId: request.taskId, query: request.query });
    let stdoutBuffer = "";
    let stdout = "";
    let stderr = "";
    let earlyExit = false;
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      terminateChild(child);
      reject(new Error(buildOpenCodeFailureMessage("timed out", timeoutMs, stdout, stderr, parser.result())));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (parser.addLine(line) && !settled) {
          earlyExit = true;
          settled = true;
          clearTimeout(timeout);
          terminateChild(child);
          resolve(parser.result({ earlyExit }));
          return;
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (error.code === "ENOENT") {
        const missing = new Error(
          "OpenCode is not installed or not on PATH. Install OpenCode, then rerun with --search-provider opencode-web."
        ) as NodeJS.ErrnoException;
        missing.code = "ENOENT";
        reject(missing);
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (stdoutBuffer.trim()) {
        parser.addLine(stdoutBuffer);
      }
      if (code !== 0) {
        reject(new Error(buildOpenCodeFailureMessage(`failed with exit code ${code}`, timeoutMs, stdout, stderr, parser.result())));
        return;
      }
      resolve(parser.result({ earlyExit }));
    });
  });
}

export function buildOpenCodeFailureMessage(
  reason: string,
  timeoutMs: number,
  stdout: string,
  stderr: string,
  result?: Pick<SearchProviderResult, "rawEventsCount" | "sources">
): string {
  return [
    `OpenCode websearch ${reason}.`,
    `timeoutMs=${timeoutMs}`,
    `rawEventsParsed=${result?.rawEventsCount ?? "unknown"}`,
    `sourcesParsed=${result?.sources.length ?? "unknown"}`,
    `stdoutPreview=${JSON.stringify(lastChars(stdout, 2000))}`,
    `stderrPreview=${JSON.stringify(lastChars(stderr, 2000))}`
  ].join(" ");
}

function lastChars(value: string, count: number): string {
  return value.length > count ? value.slice(-count) : value;
}

function clampRetries(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 2;
  }
  return Math.min(5, Math.max(0, Math.trunc(value)));
}

function withRetryUsage(
  result: SearchProviderResult,
  stats: { attempts: number; failures: number; lastError?: Error }
): SearchProviderResult {
  return {
    ...result,
    usage: {
      calls: result.usage?.calls ?? 1,
      attempts: stats.attempts,
      websearchCalls: result.usage?.websearchCalls,
      webfetchCalls: result.usage?.webfetchCalls,
      retries: Math.max(0, stats.attempts - 1),
      failures: stats.failures,
      ...(stats.lastError ? { lastError: safeError(stats.lastError) } : {}),
      ...(result.usage?.tokensUnavailable ? { tokensUnavailable: result.usage.tokensUnavailable } : {}),
      tokens: result.usage?.tokens
    }
  };
}

function normalizeOpenCodeError(error: unknown): Error {
  if (isMissingBinaryError(error)) {
    const missing = new Error(
      "OpenCode is not installed or not on PATH. Install OpenCode, then rerun with --search-provider opencode-web."
    ) as NodeJS.ErrnoException;
    missing.code = "ENOENT";
    return missing;
  }
  return error instanceof Error ? error : new Error(String(error));
}

function isMissingBinaryError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function emit(request: SearchProviderRequest, type: string, metadata: Record<string, unknown>): Promise<void> {
  await request.onEvent?.(type, metadata);
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function terminateChild(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }, 1000).unref();
}
