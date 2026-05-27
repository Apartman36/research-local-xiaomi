import { describe, expect, it } from "vitest";
import {
  buildOpenCodeFailureMessage,
  buildPrompt,
  runOpenCodeWithRetries,
  type OpenCodeAttemptRunner
} from "../src/search/opencode-websearch.js";

describe("OpenCode websearch adapter", () => {
  it("builds the known-working single-line websearch prompt", () => {
    const prompt = buildPrompt({
      taskId: "T001",
      query: "AI interior design tools commercial solutions 2024",
      focus: "web",
      maxResults: 5
    });

    expect(prompt).toBe(
      "Use websearch exactly once for this query: AI interior design tools commercial solutions 2024. Return only 5 sources with title, URL, and short summary. Do not write files. Do not use bash. Do not use subagents. Do not use the task tool."
    );
    expect(prompt).not.toMatch(/\r|\n/);
  });

  it("adds GitHub focus guidance without making the prompt multiline", () => {
    const prompt = buildPrompt({
      taskId: "T001",
      query: "vector database examples",
      focus: "github",
      maxResults: 3
    });

    expect(prompt).toContain("Prefer GitHub repositories, READMEs, docs, examples, issues, and implementation details.");
    expect(prompt).not.toMatch(/\r|\n/);
  });

  it("includes bounded stdout and stderr previews in failure diagnostics", () => {
    const message = buildOpenCodeFailureMessage(
      "timed out",
      60_000,
      `${"a".repeat(2500)}stdout tail`,
      `${"b".repeat(2500)}stderr tail`,
      { rawEventsCount: 4, sources: [{ provider: "opencode-web", query: "q", url: "https://example.com" }] }
    );

    expect(message).toContain("OpenCode websearch timed out.");
    expect(message).toContain("timeoutMs=60000");
    expect(message).toContain("rawEventsParsed=4");
    expect(message).toContain("sourcesParsed=1");
    expect(message).toContain("stdout tail");
    expect(message).toContain("stderr tail");
    expect(message).not.toContain("a".repeat(2100));
    expect(message).not.toContain("b".repeat(2100));
  });

  it("retries timeout-like failures and returns the first successful result", async () => {
    const attempts: number[] = [];
    const events: Array<{ type: string; metadata?: Record<string, unknown> }> = [];
    const runner: OpenCodeAttemptRunner = async (_args, _timeoutMs, request, attempt) => {
      attempts.push(attempt);
      if (attempt === 1) {
        throw new Error("OpenCode websearch timed out.");
      }
      return {
        taskId: request.taskId,
        query: request.query,
        provider: "opencode-web",
        sources: [{ provider: "opencode-web", query: request.query, url: "https://example.com" }],
        usage: { calls: 1, websearchCalls: 1, webfetchCalls: 0 }
      };
    };

    const result = await runOpenCodeWithRetries({
      args: ["run"],
      timeoutMs: 100,
      request: request({
        retries: 2,
        onEvent: (type, metadata) => {
          events.push({ type, metadata });
        }
      }),
      runner,
      retryDelaysMs: [0, 0]
    });

    expect(attempts).toEqual([1, 2]);
    expect(result.sources).toHaveLength(1);
    expect(result.usage).toMatchObject({ calls: 1, attempts: 2, retries: 1, failures: 1, websearchCalls: 1 });
    expect(events.map((event) => event.type)).toEqual([
      "opencode_search_attempt_started",
      "opencode_search_attempt_failed",
      "opencode_search_retry",
      "opencode_search_attempt_started"
    ]);
  });

  it("retries zero-source results before returning success", async () => {
    const runner: OpenCodeAttemptRunner = async (_args, _timeoutMs, request, attempt) => ({
      taskId: request.taskId,
      query: request.query,
      provider: "opencode-web",
      sources: attempt === 1 ? [] : [{ provider: "opencode-web", query: request.query, url: "https://example.com/a" }],
      usage: { calls: 1, websearchCalls: 1, webfetchCalls: 0 }
    });

    const result = await runOpenCodeWithRetries({
      args: ["run"],
      timeoutMs: 100,
      request: request({ retries: 2 }),
      runner,
      retryDelaysMs: [0, 0]
    });

    expect(result.sources).toHaveLength(1);
    expect(result.usage).toMatchObject({ calls: 1, attempts: 2, retries: 1, failures: 1 });
  });

  it("does not retry a missing OpenCode binary", async () => {
    let attempts = 0;
    const runner: OpenCodeAttemptRunner = async () => {
      attempts += 1;
      const error = new Error("not found") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    };

    await expect(
      runOpenCodeWithRetries({
        args: ["run"],
        timeoutMs: 100,
        request: request({ retries: 2 }),
        runner,
        retryDelaysMs: [0, 0]
      })
    ).rejects.toThrow(/not installed|not found/i);
    expect(attempts).toBe(1);
  });

  it("throws the final error with retry context when all attempts fail", async () => {
    const runner: OpenCodeAttemptRunner = async () => {
      throw new Error("OpenCode websearch failed with exit code 1.");
    };

    await expect(
      runOpenCodeWithRetries({
        args: ["run"],
        timeoutMs: 100,
        request: request({ retries: 2 }),
        runner,
        retryDelaysMs: [0, 0]
      })
    ).rejects.toThrow(/failed after 3 attempts/i);
  });
});

function request(overrides: Partial<Parameters<typeof runOpenCodeWithRetries>[0]["request"]> = {}) {
  return {
    taskId: "T001",
    query: "query",
    focus: "web" as const,
    maxResults: 5,
    ...overrides
  };
}
