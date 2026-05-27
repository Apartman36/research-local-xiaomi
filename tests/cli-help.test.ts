import { describe, expect, it } from "vitest";
import { createProgram } from "../src/cli.js";

describe("CLI help", () => {
  it("documents OpenCode retries on the run command", () => {
    const runCommand = createProgram().commands.find((command) => command.name() === "run");

    expect(runCommand?.helpInformation()).toContain("--opencode-retries <n>");
  });
});
