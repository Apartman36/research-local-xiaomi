import { describe, expect, it } from "vitest";
import { buildOpenCodeFailureMessage, buildPrompt } from "../src/search/opencode-websearch.js";

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
});
