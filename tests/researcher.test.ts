import { describe, expect, it } from "vitest";
import { runResearchTask } from "../src/agents/researcher.js";
import type { SearchProvider } from "../src/search/search-provider.js";
import type { ResearchProfile, SearchTask } from "../src/types.js";

describe("runResearchTask", () => {
  it("caps provider sources to the profile limit", async () => {
    const task: SearchTask = {
      id: "T001",
      subquestionId: "SQ001",
      query: "query",
      depth: 1,
      focus: "web"
    };
    const profile: ResearchProfile = {
      name: "smoke5",
      targetUniqueSources: 5,
      initialSubquestions: 1,
      maxDepth: 1,
      maxKeyword: 1,
      limit: 5,
      maxConcurrentSearches: 1,
      model: "mimo-v2.5-pro",
      language: "en"
    };
    const provider: SearchProvider = {
      name: "opencode-web",
      search: async () => ({
        taskId: task.id,
        query: task.query,
        provider: "opencode-web",
        sources: Array.from({ length: 8 }, (_, index) => ({
          title: `Source ${index + 1}`,
          url: `https://example.com/source-${index + 1}`,
          provider: "opencode-web",
          query: task.query
        })),
        usage: { calls: 1, websearchCalls: 1, webfetchCalls: 0 }
      })
    };

    const finding = await runResearchTask({
      apiKey: "test-key",
      baseUrl: "https://example.com",
      model: "mimo-v2.5-pro",
      maxCompletionTokens: 1000,
      profile,
      task,
      searchProvider: provider,
      dryRun: false
    });

    expect(finding.annotations).toHaveLength(5);
    expect(finding.providerResult?.sources).toHaveLength(5);
  });
});
