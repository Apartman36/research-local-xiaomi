import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildRunConfig } from "../src/config.js";

describe("search provider config", () => {
  it("defaults to opencode-web", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "research-xm-"));
    const promptPath = path.join(dir, "prompt.md");
    await writeFile(promptPath, "Research prompt", "utf8");

    const config = await buildRunConfig({ file: promptPath });

    expect(config.searchProvider).toBe("opencode-web");
    expect(config.opencodeModel).toBe("xiaomi-token-plan-sgp/mimo-v2.5-pro");
  });

  it("accepts xiaomi-native", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "research-xm-"));
    const promptPath = path.join(dir, "prompt.md");
    await writeFile(promptPath, "Research prompt", "utf8");

    const config = await buildRunConfig({ file: promptPath, searchProvider: "xiaomi-native" });

    expect(config.searchProvider).toBe("xiaomi-native");
  });
});

