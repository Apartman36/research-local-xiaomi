import { mkdir, mkdtemp, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listRuns, resolveRun } from "../src/store/run-store.js";

describe("run store latest resolution", () => {
  it("prefers run id timestamps over directory mtime", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "research-xm-runs-"));
    const olderRunId = "2026-05-27T21-57-45-202Z-xm";
    const newerRunId = "2026-05-28T09-13-54-582Z-xm";
    await mkdir(path.join(outputDir, olderRunId));
    await mkdir(path.join(outputDir, newerRunId));
    await touchRunDir(path.join(outputDir, olderRunId), "2026-05-29T00:00:00.000Z");
    await touchRunDir(path.join(outputDir, newerRunId), "2026-05-28T09:13:54.582Z");

    await expect(resolveRun(outputDir, "latest")).resolves.toBe(path.join(outputDir, newerRunId));
    await expect(listRuns(outputDir)).resolves.toEqual([newerRunId, olderRunId]);
  });

  it("falls back to directory mtime for run ids without parseable timestamps", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "research-xm-runs-"));
    const olderRunId = "legacy-alpha";
    const newerRunId = "legacy-beta";
    await mkdir(path.join(outputDir, olderRunId));
    await mkdir(path.join(outputDir, newerRunId));
    await touchRunDir(path.join(outputDir, olderRunId), "2026-05-27T00:00:00.000Z");
    await touchRunDir(path.join(outputDir, newerRunId), "2026-05-28T00:00:00.000Z");

    await expect(resolveRun(outputDir, "latest")).resolves.toBe(path.join(outputDir, newerRunId));
    await expect(listRuns(outputDir)).resolves.toEqual([newerRunId, olderRunId]);
  });
});

async function touchRunDir(runDir: string, isoTimestamp: string): Promise<void> {
  const timestamp = new Date(isoTimestamp);
  await utimes(runDir, timestamp, timestamp);
}
