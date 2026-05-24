import { describe, expect, it } from "vitest";
import { parseOpenCodeWebsearchOutput } from "../src/search/parse-opencode-websearch-output.js";

describe("parseOpenCodeWebsearchOutput", () => {
  it("parses one source", () => {
    const sources = parseOpenCodeWebsearchOutput(
      `Title: Versee - AI Interior Designer
URL: https://www.versee.ai/
Published: N/A
Author: N/A
Highlights:
AI-powered interior design in 3D.`,
      { query: "ai interior design" }
    );

    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      title: "Versee - AI Interior Designer",
      url: "https://www.versee.ai/",
      publishedDate: undefined,
      author: undefined,
      provider: "opencode-web",
      query: "ai interior design"
    });
  });

  it("parses multiple sources separated by dividers and skips missing URLs", () => {
    const sources = parseOpenCodeWebsearchOutput(
      `Title: Missing URL
Published: 2026-01-01
Highlights:
No URL.

---

Title: Habitas
URL: https://habitas.ai/
Published: 2026-02-03T14:00:01.000Z
Highlights:
Interior design tool.

---

Title: Krea
URL: https://www.krea.ai/
Published: N/A
Author: Krea
Highlights:
Visual AI tool.`,
      { query: "query" }
    );

    expect(sources.map((source) => source.url)).toEqual(["https://habitas.ai/", "https://www.krea.ai/"]);
    expect(sources[0]?.author).toBeUndefined();
    expect(sources[1]?.author).toBe("Krea");
  });

  it("ignores markdown fences around output", () => {
    const sources = parseOpenCodeWebsearchOutput(
      "```text\nTitle: Docs\nURL: https://example.com/docs\nPublished: N/A\nAuthor: N/A\nHighlights:\nDocs text.\n```",
      { query: "docs" }
    );

    expect(sources).toHaveLength(1);
    expect(sources[0]?.summary).toBe("Docs text.");
  });
});

