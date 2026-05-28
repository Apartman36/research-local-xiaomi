import { access, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const expectedFiles = [
  "docs/CODEX_RESEARCH_WORKFLOW.md",
  "docs/COMMANDS_REFERENCE.md",
  "docs/V05_NEXT_PATCHES_REMINDER.md",
  ".codex/skills/use-research-xm/SKILL.md",
  "prompts/dev-research-template.md",
  "prompts/open-source-agentic-research-systems.md",
  "knowledge/research-log.md",
  "knowledge/backlog.md"
];

describe("project documentation seeds", () => {
  it.each(expectedFiles)("%s exists", async (filePath) => {
    await expect(access(filePath)).resolves.toBeUndefined();
  });
});

describe("repo skill docs", () => {
  it("mention the v0.5 reminder file", async () => {
    const text = await readFile(".codex/skills/use-research-xm/SKILL.md", "utf8");

    expect(text).toContain("docs/V05_NEXT_PATCHES_REMINDER.md");
  });
});
