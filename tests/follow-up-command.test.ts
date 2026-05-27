import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { printFollowUpCommand } from "../src/cli.js";

describe("follow-up command", () => {
  it("writes a follow-up prompt for the latest complete run", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "research-xm-follow-up-"));
    const runDir = path.join(outputDir, "2026-05-27T21-31-57-984Z-xm");
    await mkdir(runDir);
    await writeCompleteArtifacts(runDir);

    const output = await printFollowUpCommand("latest", { outputDir, writePromptOnly: true });
    const promptPath = path.join(runDir, "follow_up_prompt.md");
    const prompt = await readFile(promptPath, "utf8");

    expect(output).toBe(`Follow-up prompt written: ${promptPath}\n`);
    expect(prompt).toContain("# Follow-Up Research Task");
    expect(prompt).toContain("- Parent run ID: 2026-05-27T21-31-57-984Z-xm");
    expect(prompt).toContain("Independent benchmarks");
    expect(prompt).toContain("Check maintainer issue threads");
  });

  it("handles a missing report review gracefully", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "research-xm-follow-up-"));
    const runDir = path.join(outputDir, "2026-05-27T21-31-57-984Z-xm");
    await mkdir(runDir);
    await writeCompleteArtifacts(runDir, { reportReview: false });

    await printFollowUpCommand("latest", { outputDir, writePromptOnly: true });
    const prompt = await readFile(path.join(runDir, "follow_up_prompt.md"), "utf8");

    expect(prompt).toContain("Missing inputs");
    expect(prompt).toContain("report_review.json");
    expect(prompt).toContain("report_review.md");
  });

  it("rejects an unknown explicit run", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "research-xm-follow-up-"));

    await expect(printFollowUpCommand("missing-run", { outputDir, writePromptOnly: true })).rejects.toThrow(
      "Run not found"
    );
  });

  it("requires --write-prompt-only", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "research-xm-follow-up-"));
    const runDir = path.join(outputDir, "2026-05-27T21-31-57-984Z-xm");
    await mkdir(runDir);

    await expect(printFollowUpCommand("latest", { outputDir, writePromptOnly: false })).rejects.toThrow(
      "--write-prompt-only is required"
    );
  });

  it("generates a prompt containing parentRunId and top gaps", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "research-xm-follow-up-"));
    const runDir = path.join(outputDir, "2026-05-27T21-31-57-984Z-xm");
    await mkdir(runDir);
    await writeCompleteArtifacts(runDir);

    await printFollowUpCommand("latest", { outputDir, writePromptOnly: true });
    const prompt = await readFile(path.join(runDir, "follow_up_prompt.md"), "utf8");

    expect(prompt).toContain("parentRunId: 2026-05-27T21-31-57-984Z-xm");
    expect(prompt).toContain("Independent benchmarks");
    await expect(stat(path.join(runDir, "follow_up_prompt.md"))).resolves.toBeTruthy();
  });
});

async function writeCompleteArtifacts(runDir: string, options: { reportReview?: boolean } = {}): Promise<void> {
  await writeFile(path.join(runDir, "input.md"), "# Topic\n\nResearch TypeScript CLI reliability patterns.", "utf8");
  await writeFile(
    path.join(runDir, "plan.json"),
    JSON.stringify({
      topic: "TypeScript CLI reliability patterns",
      objective: "Find practical implementation guidance.",
      subquestions: [
        { id: "SQ1", question: "How do mature CLIs keep retry behavior reliable?" },
        { id: "SQ2", question: "Which failure modes are common in agent research tools?" }
      ],
      searchTasks: []
    }),
    "utf8"
  );
  await writeFile(
    path.join(runDir, "critique.json"),
    JSON.stringify({
      summary: "Useful but missing independent operational evidence.",
      weakAreas: ["Too much vendor documentation"],
      missingCoverage: ["Independent benchmarks", "Maintainer issue threads"],
      duplicateEvidence: [],
      followUpTasks: [
        {
          id: "T900",
          subquestionId: "SQ1",
          query: "Check maintainer issue threads for CLI retry failure modes",
          depth: 1,
          focus: "github"
        }
      ],
      needsFollowUp: true
    }),
    "utf8"
  );
  await writeFile(
    path.join(runDir, "run_summary.md"),
    [
      "# Research Run Summary",
      "",
      "## Report Review Summary",
      "",
      "- readyForUse: false",
      "- qualityScore: 71",
      "- Top gaps:",
      "  - Independent benchmarks",
      "- Top recommendations:",
      "  - Check maintainer issue threads",
      "",
      "## Next Suggested Actions",
      "",
      "- Run targeted follow-up research on: Independent benchmarks."
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.join(runDir, "report.md"),
    "# Report\n\nCovered retry flags and source extraction. Uncovered subquestions: issue failure modes.\n",
    "utf8"
  );
  if (options.reportReview !== false) {
    await writeFile(
      path.join(runDir, "report_review.json"),
      JSON.stringify({
        overallAssessment: "Good foundation, but incomplete.",
        qualityScore: 71,
        citationAssessment: {
          hasUnsupportedClaims: false,
          unsupportedClaims: [],
          citationCoverage: "Mostly cited."
        },
        sourceQuality: {
          strongSources: ["Official docs"],
          weakSources: ["Vendor blog"],
          marketingHeavy: true,
          notes: "Needs independent evidence."
        },
        gaps: [
          {
            gap: "Independent benchmarks",
            whyItMatters: "Avoid vendor bias",
            suggestedFollowUpQuery: "TypeScript CLI retry benchmark failure modes"
          }
        ],
        recommendations: ["Check maintainer issue threads"],
        readyForUse: false
      }),
      "utf8"
    );
    await writeFile(path.join(runDir, "report_review.md"), "# Report Review\n\nQuality score: 71\n", "utf8");
  }
}
