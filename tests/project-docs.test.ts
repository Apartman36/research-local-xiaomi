import { access } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const expectedFiles = [
  "docs/CODEX_RESEARCH_WORKFLOW.md",
  "docs/COMMANDS_REFERENCE.md",
  ".codex/skills/use-research-xm/SKILL.md",
  "prompts/dev-research-template.md",
  "knowledge/research-log.md",
  "knowledge/backlog.md"
];

describe("project documentation seeds", () => {
  it.each(expectedFiles)("%s exists", async (filePath) => {
    await expect(access(filePath)).resolves.toBeUndefined();
  });
});
