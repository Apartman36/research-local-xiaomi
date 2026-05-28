import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { atomicWrite, writeJson } from "./atomic-write.js";

export async function createRunDirectory(runDir: string): Promise<void> {
  await mkdir(path.join(runDir, "findings"), { recursive: true });
}

export async function writeTextArtifact(runDir: string, name: string, content: string): Promise<void> {
  await atomicWrite(path.join(runDir, name), content);
}

export async function writeJsonArtifact(runDir: string, name: string, value: unknown): Promise<void> {
  await writeJson(path.join(runDir, name), value);
}

export async function writeFinding(runDir: string, taskId: string, value: unknown): Promise<void> {
  await writeJson(path.join(runDir, "findings", `${taskId}.json`), value);
}

export async function listRuns(outputDirRoot: string): Promise<string[]> {
  await mkdir(outputDirRoot, { recursive: true });
  const names = await readdir(outputDirRoot);
  const withStats = await Promise.all(
    names.map(async (name) => {
      const fullPath = path.join(outputDirRoot, name);
      const itemStat = await stat(fullPath);
      return {
        name,
        mtimeMs: itemStat.mtimeMs,
        stableTimeMs: itemStat.isDirectory() ? await readStableRunTimestamp(fullPath, name) : undefined,
        isDirectory: itemStat.isDirectory()
      };
    })
  );
  return withStats
    .filter((item) => item.isDirectory)
    .sort((a, b) => (b.stableTimeMs ?? b.mtimeMs) - (a.stableTimeMs ?? a.mtimeMs))
    .map((item) => item.name);
}

export async function resolveRun(outputDirRoot: string, idOrLatest: string): Promise<string> {
  if (idOrLatest !== "latest") {
    return path.join(outputDirRoot, idOrLatest);
  }
  const runs = await listRuns(outputDirRoot);
  if (runs.length === 0) {
    throw new Error(`No runs found in ${outputDirRoot}.`);
  }
  return path.join(outputDirRoot, runs[0] ?? "");
}

export function parseRunIdTimestamp(runId: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-xm$/.exec(runId);
  if (!match) {
    return undefined;
  }
  const [, year, month, day, hour, minute, second, millisecond] = match;
  const timestamp = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}.${millisecond}Z`);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

async function readStableRunTimestamp(runDir: string, runId: string): Promise<number | undefined> {
  const runIdTimestamp = parseRunIdTimestamp(runId);
  if (runIdTimestamp !== undefined) {
    return runIdTimestamp;
  }

  const configTimestamp = await readConfigTimestamp(runDir);
  if (configTimestamp !== undefined) {
    return configTimestamp;
  }

  return readSummaryTimestamp(runDir);
}

async function readConfigTimestamp(runDir: string): Promise<number | undefined> {
  try {
    const config = JSON.parse(await readFile(path.join(runDir, "config.json"), "utf8")) as {
      startedAt?: unknown;
      createdAt?: unknown;
    };
    return parseIsoTimestamp(config.startedAt) ?? parseIsoTimestamp(config.createdAt);
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
  }
}

async function readSummaryTimestamp(runDir: string): Promise<number | undefined> {
  try {
    const summary = await readFile(path.join(runDir, "run_summary.md"), "utf8");
    return parseSummaryField(summary, "Started") ?? parseSummaryField(summary, "Finished");
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
  }
}

function parseSummaryField(summary: string, field: "Started" | "Finished"): number | undefined {
  const match = new RegExp(`^- ${field}: (.+)$`, "m").exec(summary);
  return parseIsoTimestamp(match?.[1]);
}

function parseIsoTimestamp(value: unknown): number | undefined {
  if (typeof value !== "string" || !value.trim() || value.trim() === "missing") {
    return undefined;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
