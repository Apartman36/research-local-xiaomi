import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildRunConfig, getProfile } from "../src/config.js";
import { runResearch } from "../src/orchestrator.js";

describe("profiles and task caps", () => {
  it("defines the smoke5 profile", () => {
    expect(getProfile("smoke5")).toMatchObject({
      name: "smoke5",
      targetUniqueSources: 5,
      initialSubquestions: 1,
      maxDepth: 1,
      maxKeyword: 1,
      limit: 5,
      maxConcurrentSearches: 1,
      model: "mimo-v2.5-pro",
      language: "en"
    });
  });

  it("caps planned researcher tasks with maxTasks", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "research-xm-"));
    const promptPath = path.join(dir, "prompt.md");
    await writeFile(promptPath, "Research prompt", "utf8");

    const config = await buildRunConfig({
      file: promptPath,
      outputDir: dir,
      profile: "normal100",
      maxTasks: 1,
      dryRun: true
    });
    await runResearch(config, "dry-run");

    const queries = JSON.parse(await readFile(path.join(config.runDir, "queries.json"), "utf8"));
    expect(queries).toHaveLength(1);
  });
});
