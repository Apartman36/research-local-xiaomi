import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CriticResult } from "../src/agents/critic.js";
import type { Critique } from "../src/types.js";

const mocks = vi.hoisted(() => {
  const fallbackCritique: Critique = {
    summary: "Critic returned malformed JSON; follow-up planning was skipped.",
    weakAreas: ["Critic returned malformed JSON; follow-up planning was skipped."],
    missingCoverage: [],
    duplicateEvidence: [],
    followUpTasks: [],
    needsFollowUp: false
  };

  return {
    fallbackCritique,
    criticResult: {
      critique: fallbackCritique,
      parseFailed: true,
      parseError: "Expected ',' or ']' after array element in JSON at position 2425"
    } as CriticResult,
    runResearchTask: vi.fn(),
    runWriter: vi.fn()
  };
});

vi.mock("../src/agents/planner.js", () => ({
  runPlanner: vi.fn(async () => ({
    plan: {
      topic: "Topic",
      objective: "Objective",
      assumptions: [],
      subquestions: [{ id: "SQ001", question: "Question" }],
      searchTasks: [
        {
          id: "T001",
          subquestionId: "SQ001",
          query: "query",
          depth: 1,
          focus: "web"
        }
      ]
    }
  }))
}));

vi.mock("../src/agents/researcher.js", () => ({
  runResearchTask: mocks.runResearchTask
}));

vi.mock("../src/agents/critic.js", () => ({
  runCritic: vi.fn(async () => mocks.criticResult)
}));

vi.mock("../src/agents/writer.js", () => ({
  runWriter: mocks.runWriter
}));

const { buildRunConfig } = await import("../src/config.js");
const { runResearch } = await import("../src/orchestrator.js");

describe("orchestrator critic fallback", () => {
  beforeEach(() => {
    mocks.criticResult = {
      critique: mocks.fallbackCritique,
      parseFailed: true,
      parseError: "Expected ',' or ']' after array element in JSON at position 2425"
    };
    mocks.runResearchTask.mockReset();
    mocks.runResearchTask.mockResolvedValue({
      taskId: "T001",
      subquestionId: "SQ001",
      query: "query",
      assistantSynthesis: "Found source.",
      annotations: [
        {
          url: "https://example.com/source",
          canonicalUrl: "https://example.com/source",
          title: "Source",
          summary: "Summary",
          siteName: "Example"
        }
      ],
      claims: [
        {
          id: "T001-C001",
          subquestionId: "SQ001",
          taskId: "T001",
          text: "Claim.",
          sourceIds: ["https://example.com/source"],
          confidence: "medium"
        }
      ]
    });
    mocks.runWriter.mockReset();
    mocks.runWriter.mockResolvedValue({ report: "# Topic\n\nReport with a citation [1].\n" });
  });

  it("proceeds to writer after critic parse failure when sources exist", async () => {
    const config = await testConfig({ maxTasks: 1 });

    const result = await runResearch(config, "test-key");
    const events = await readEvents(config.runDir);
    const critique = JSON.parse(await readFile(path.join(config.runDir, "critique.json"), "utf8"));

    expect(mocks.runWriter).toHaveBeenCalledTimes(1);
    expect(result.lintOk).toBe(true);
    expect(critique).toEqual(mocks.fallbackCritique);
    expect(events.map((event) => event.type)).toContain("critic_parse_failed");
    expect(events.map((event) => event.type)).toContain("critic_fallback_used");
    expect(events.map((event) => event.type)).toContain("writer_completed");
    expect(events.map((event) => event.type)).toContain("research_completed");
  });

  it("skips critic follow-ups when maxTasks capacity is exhausted", async () => {
    mocks.criticResult = {
      critique: {
        ...mocks.fallbackCritique,
        needsFollowUp: true,
        followUpTasks: [
          {
            id: "G001",
            subquestionId: "SQ001",
            query: "follow up",
            rationale: "needed",
            depth: 1,
            focus: "web"
          }
        ]
      }
    };
    const config = await testConfig({ maxTasks: 1 });

    await runResearch(config, "test-key");
    const events = await readEvents(config.runDir);

    expect(mocks.runResearchTask).toHaveBeenCalledTimes(1);
    expect(events.map((event) => event.type)).toContain("follow_up_skipped_task_cap_reached");
    expect(events.map((event) => event.type)).toContain("writer_completed");
  });
});

async function testConfig(options: { maxTasks: number }) {
  const dir = await mkdtemp(path.join(tmpdir(), "research-xm-"));
  const promptPath = path.join(dir, "prompt.md");
  await writeFile(promptPath, "Research prompt", "utf8");

  return buildRunConfig({
    file: promptPath,
    outputDir: dir,
    profile: "smoke5",
    searchProvider: "opencode-web",
    maxTasks: options.maxTasks
  });
}

async function readEvents(runDir: string): Promise<Array<{ type: string } & Record<string, unknown>>> {
  const text = await readFile(path.join(runDir, "events.jsonl"), "utf8");
  return text
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
