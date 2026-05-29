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
    expect(config.opencodeRetries).toBe(2);
    expect(config.quotaMode).toBe("normal");
    expect(config.promptNormalize).toBe(true);
  });

  it.each(["normal", "conservative", "aggressive"] as const)("accepts quota mode %s", async (quotaMode) => {
    const dir = await mkdtemp(path.join(tmpdir(), "research-xm-"));
    const promptPath = path.join(dir, "prompt.md");
    await writeFile(promptPath, "Research prompt", "utf8");

    const config = await buildRunConfig({ file: promptPath, quotaMode });

    expect(config.quotaMode).toBe(quotaMode);
  });

  it("rejects invalid quota mode", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "research-xm-"));
    const promptPath = path.join(dir, "prompt.md");
    await writeFile(promptPath, "Research prompt", "utf8");

    await expect(buildRunConfig({ file: promptPath, quotaMode: "reckless" as never })).rejects.toThrow();
  });

  it("accepts bounded OpenCode retries", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "research-xm-"));
    const promptPath = path.join(dir, "prompt.md");
    await writeFile(promptPath, "Research prompt", "utf8");

    const config = await buildRunConfig({ file: promptPath, opencodeRetries: "5" });

    expect(config.opencodeRetries).toBe(5);
  });

  it("rejects invalid OpenCode retries", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "research-xm-"));
    const promptPath = path.join(dir, "prompt.md");
    await writeFile(promptPath, "Research prompt", "utf8");

    await expect(buildRunConfig({ file: promptPath, opencodeRetries: "-1" })).rejects.toThrow();
    await expect(buildRunConfig({ file: promptPath, opencodeRetries: "6" })).rejects.toThrow();
  });

  it("accepts and persists Xiaomi role timeouts", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "research-xm-"));
    const promptPath = path.join(dir, "prompt.md");
    await writeFile(promptPath, "Research prompt", "utf8");

    const config = await buildRunConfig({
      file: promptPath,
      xiaomiTimeoutMs: "180000",
      writerTimeoutMs: "300000"
    });

    expect(config.xiaomiTimeoutMs).toBe(180000);
    expect(config.writerTimeoutMs).toBe(300000);
  });

  it("rejects invalid Xiaomi role timeouts", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "research-xm-"));
    const promptPath = path.join(dir, "prompt.md");
    await writeFile(promptPath, "Research prompt", "utf8");

    await expect(buildRunConfig({ file: promptPath, xiaomiTimeoutMs: "999" })).rejects.toThrow();
    await expect(buildRunConfig({ file: promptPath, writerTimeoutMs: "600001" })).rejects.toThrow();
  });

  it("accepts xiaomi-native", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "research-xm-"));
    const promptPath = path.join(dir, "prompt.md");
    await writeFile(promptPath, "Research prompt", "utf8");

    const config = await buildRunConfig({ file: promptPath, searchProvider: "xiaomi-native" });

    expect(config.searchProvider).toBe("xiaomi-native");
  });

  it("defaults researcher extraction and report review to enabled", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "research-xm-"));
    const promptPath = path.join(dir, "prompt.md");
    await writeFile(promptPath, "Research prompt", "utf8");

    const config = await buildRunConfig({ file: promptPath });

    expect(config.researcherMode).toBe("extract");
    expect(config.reviewReport).toBe(true);
    expect(config.notify).toBe(false);
  });

  it("accepts mechanical researcher mode and notify", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "research-xm-"));
    const promptPath = path.join(dir, "prompt.md");
    await writeFile(promptPath, "Research prompt", "utf8");

    const config = await buildRunConfig({ file: promptPath, researcherMode: "mechanical", notify: true });

    expect(config.researcherMode).toBe("mechanical");
    expect(config.notify).toBe(true);
  });

  it("persists prompt normalization setting", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "research-xm-"));
    const promptPath = path.join(dir, "prompt.md");
    await writeFile(promptPath, "Research prompt", "utf8");

    const enabled = await buildRunConfig({ file: promptPath, promptNormalize: true });
    const disabled = await buildRunConfig({ file: promptPath, promptNormalize: false });

    expect(enabled.promptNormalize).toBe(true);
    expect(disabled.promptNormalize).toBe(false);
  });

  it("rejects invalid researcher mode", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "research-xm-"));
    const promptPath = path.join(dir, "prompt.md");
    await writeFile(promptPath, "Research prompt", "utf8");

    await expect(buildRunConfig({ file: promptPath, researcherMode: "fast" as never })).rejects.toThrow();
  });
});
