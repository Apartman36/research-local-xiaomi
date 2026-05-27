import { describe, expect, it } from "vitest";
import { createProgram } from "../src/cli.js";

describe("CLI help", () => {
  it("documents OpenCode retries on the run command", () => {
    const runCommand = createProgram().commands.find((command) => command.name() === "run");

    expect(runCommand?.helpInformation()).toContain("--opencode-retries <n>");
    expect(runCommand?.helpInformation()).toContain("--xiaomi-timeout-ms <ms>");
    expect(runCommand?.helpInformation()).toContain("--writer-timeout-ms <ms>");
  });

  it("documents the safe follow-up prompt command", () => {
    const followUpCommand = createProgram().commands.find((command) => command.name() === "follow-up");

    expect(followUpCommand?.helpInformation()).toContain("--write-prompt-only");
    expect(followUpCommand?.helpInformation()).toContain("--execute");
    expect(followUpCommand?.helpInformation()).toContain("--xiaomi-timeout-ms <ms>");
  });
});
