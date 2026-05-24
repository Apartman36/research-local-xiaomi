import { mkdir, readdir, stat } from "node:fs/promises";
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
      return { name, mtimeMs: itemStat.mtimeMs, isDirectory: itemStat.isDirectory() };
    })
  );
  return withStats
    .filter((item) => item.isDirectory)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
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
