import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { printSummaryCommand } from "../src/cli.js";

describe("summary command", () => {
  it("prints an existing latest run summary", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "research-xm-summary-command-"));
    const runDir = path.join(outputDir, "2026-05-26T21-31-57-984Z-xm");
    await mkdir(runDir);
    await writeFile(path.join(runDir, "run_summary.md"), "# Existing Summary\n", "utf8");

    const output = await printSummaryCommand("latest", { outputDir });

    expect(output).toBe("# Existing Summary\n");
  });

  it("generates and prints summary when missing", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "research-xm-summary-command-"));
    const runDir = path.join(outputDir, "2026-05-26T21-31-57-984Z-xm");
    await mkdir(runDir);
    await writeFile(path.join(runDir, "report.md"), "# Report\n", "utf8");

    const output = await printSummaryCommand("latest", { outputDir });
    const generated = await readFile(path.join(runDir, "run_summary.md"), "utf8");

    expect(output).toContain(generated.trimEnd());
    expect(output).toContain("Research Run Summary");
    expect(output).toContain("- Usage: missing");
    expect(output).toContain("Run is incomplete: usage.json not found.");
    expect(output).toContain("Existing files:");
  });

  it("prints only the path with --path", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "research-xm-summary-command-"));
    const runDir = path.join(outputDir, "2026-05-26T21-31-57-984Z-xm");
    await mkdir(runDir);
    await writeFile(path.join(runDir, "run_summary.md"), "# Existing Summary\n", "utf8");

    const output = await printSummaryCommand("latest", { outputDir, pathOnly: true });

    expect(output).toBe(`${path.join(runDir, "run_summary.md")}\n`);
  });
});
