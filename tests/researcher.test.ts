import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseResearcherContent, runResearchTask } from "../src/agents/researcher.js";
import type { SearchProvider } from "../src/search/search-provider.js";
import type { NormalizedAnnotation, ResearchProfile, SearchTask } from "../src/types.js";

const mocks = vi.hoisted(() => ({
  chat: vi.fn()
}));

vi.mock("../src/providers/xiaomi.js", async () => {
  const actual = await vi.importActual<typeof import("../src/providers/xiaomi.js")>("../src/providers/xiaomi.js");
  return {
    ...actual,
    chat: mocks.chat
  };
});

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

const annotations: NormalizedAnnotation[] = [
  {
    url: "https://example.com/export",
    canonicalUrl: "https://example.com/export",
    title: "Export docs",
    summary: "PDF and PNG export are documented."
  },
  {
    url: "https://example.com/limits",
    canonicalUrl: "https://example.com/limits",
    title: "Limit docs",
    summary: "OBJ export is not mentioned."
  }
];

describe("runResearchTask", () => {
  beforeEach(() => {
    mocks.chat.mockReset();
  });

  it("caps provider sources to the profile limit", async () => {
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
      researcherMode: "mechanical",
      dryRun: false
    });

    expect(finding.annotations).toHaveLength(5);
    expect(finding.providerResult?.sources).toHaveLength(5);
  });

  it("parses valid researcher JSON with URL-backed claims", () => {
    const parsed = parseResearcherContent(
      JSON.stringify({
        assistantSynthesis: "Export support is documented, but mesh export is not confirmed.",
        claims: [
          {
            claim: "The documentation confirms PDF and PNG export.",
            sourceUrls: ["https://example.com/export"],
            confidence: "high",
            claimType: "fact"
          }
        ],
        warnings: ["Vendor docs do not prove unsupported formats are impossible."]
      }),
      { task, annotations }
    );

    expect(parsed.parseFailed).toBeUndefined();
    expect(parsed.assistantSynthesis).toContain("mesh export");
    expect(parsed.claims).toEqual([
      expect.objectContaining({
        text: "The documentation confirms PDF and PNG export.",
        sourceIds: ["https://example.com/export"],
        confidence: "high"
      })
    ]);
    expect(parsed.warnings).toHaveLength(1);
  });

  it("parses fenced researcher JSON and maps source indexes", () => {
    const parsed = parseResearcherContent(
      "```json\n{\"assistantSynthesis\":\"Indexed sources work.\",\"claims\":[{\"text\":\"OBJ export is not confirmed by the available docs.\",\"sourceIndexes\":[2],\"confidence\":\"low\",\"claimType\":\"limitation\"}]}\n```",
      { task, annotations }
    );

    expect(parsed.parseFailed).toBeUndefined();
    expect(parsed.claims[0]?.sourceIds).toEqual(["https://example.com/limits"]);
    expect(parsed.claims[0]?.text).toContain("OBJ export");
  });

  it("returns a parse failure for malformed researcher JSON", () => {
    const parsed = parseResearcherContent('{"assistantSynthesis":"broken","claims":[}', { task, annotations });

    expect(parsed.parseFailed).toBe(true);
    expect(parsed.claims).toEqual([]);
    expect(parsed.parseError).toBeTruthy();
  });

  it("handles unknown researcher source references safely", () => {
    const parsed = parseResearcherContent(
      JSON.stringify({
        assistantSynthesis: "Unknown references are ignored.",
        claims: [
          {
            claim: "A claim with one valid and one invalid source.",
            sourceUrls: ["https://example.com/export", "https://missing.example/nope"],
            confidence: "high"
          }
        ]
      }),
      { task, annotations }
    );

    expect(parsed.unmatchedSourceRefs).toEqual(["https://missing.example/nope"]);
    expect(parsed.claims[0]?.sourceIds).toEqual(["https://example.com/export"]);
  });

  it("tolerates nullable optional researcher fields", () => {
    const parsed = parseResearcherContent(
      JSON.stringify({
        assistantSynthesis: "Nullable optional fields are ignored.",
        claims: [
          {
            claim: "The documentation confirms PDF export.",
            sourceUrls: null,
            sourceIndexes: [1],
            confidence: "high",
            limitations: null
          }
        ],
        warnings: null
      }),
      { task, annotations }
    );

    expect(parsed.parseFailed).toBeUndefined();
    expect(parsed.claims[0]?.text).toBe("The documentation confirms PDF export.");
    expect(parsed.claims[0]?.sourceIds).toEqual(["https://example.com/export"]);
  });

  it("falls back to mechanical extraction when Xiaomi researcher returns malformed JSON", async () => {
    mocks.chat.mockResolvedValue({
      choices: [{ message: { content: '{"assistantSynthesis":"broken","claims":[}' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
    });
    const provider: SearchProvider = {
      name: "opencode-web",
      search: async () => ({
        taskId: task.id,
        query: task.query,
        provider: "opencode-web",
        sources: [
          {
            title: "Export docs",
            url: "https://example.com/export",
            summary: "PDF and PNG export are documented.",
            provider: "opencode-web",
            query: task.query
          }
        ],
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
      researcherMode: "extract",
      dryRun: false
    });

    expect(finding.extractionMode).toBe("fallback");
    expect(finding.parseFailed).toBe(true);
    expect(finding.usage?.total_tokens).toBe(15);
    expect(finding.claims[0]?.text).toContain("provides evidence relevant");
  });

  it("uses Xiaomi-generated claims when researcher extraction succeeds", async () => {
    mocks.chat.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              assistantSynthesis: "PDF export is supported; OBJ export remains unconfirmed.",
              claims: [
                {
                  claim: "PDF export is supported by the export documentation.",
                  sourceIndexes: [1],
                  confidence: "high",
                  claimType: "fact"
                }
              ]
            })
          }
        }
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
    });
    const provider: SearchProvider = {
      name: "opencode-web",
      search: async () => ({
        taskId: task.id,
        query: task.query,
        provider: "opencode-web",
        sources: [
          {
            title: "Export docs",
            url: "https://example.com/export",
            summary: "PDF and PNG export are documented.",
            provider: "opencode-web",
            query: task.query
          }
        ],
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
      researcherMode: "extract",
      dryRun: false
    });

    expect(finding.extractionMode).toBe("xiaomi");
    expect(finding.assistantSynthesis).toContain("OBJ export");
    expect(finding.claims[0]?.text).toBe("PDF export is supported by the export documentation.");
    expect(finding.usage?.total_tokens).toBe(15);
  });
});
