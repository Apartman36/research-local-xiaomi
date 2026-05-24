import { spawn } from "node:child_process";
import { parseOpenCodeEvents } from "./parse-opencode-events.js";
import type { SearchProvider, SearchProviderRequest, SearchProviderResult } from "./search-provider.js";

export class OpenCodeWebSearchProvider implements SearchProvider {
  readonly name = "opencode-web" as const;

  async search(request: SearchProviderRequest): Promise<SearchProviderResult> {
    const prompt = buildPrompt(request);
    const args = ["run", "--format", "json"];
    const model = process.env.OPENCODE_MODEL;
    if (model) {
      args.push("--model", model);
    }
    args.push(prompt);

    const stdout = await runOpenCode(args, request.timeoutMs ?? 180_000);
    return parseOpenCodeEvents(stdout, { taskId: request.taskId, query: request.query });
  }
}

function buildPrompt(request: SearchProviderRequest): string {
  const focusInstruction =
    request.focus === "github"
      ? "Prioritize GitHub repositories, READMEs, docs, examples, issues, releases, and implementation details."
      : "Search broadly across the web.";
  return [
    "Use the websearch tool only.",
    "Do not write files. Do not use bash. Do not use subagents. Do not use the task tool.",
    "Return sources only. Search for current, high-quality sources.",
    "Prefer official docs, GitHub repos, technical articles, papers, and product docs when relevant.",
    focusInstruction,
    `Find up to ${request.maxResults} sources for this query: ${request.query}`,
    "Return concise source results in the websearch output format with Title, URL, Published, Author, and Highlights."
  ].join("\n");
}

function runOpenCode(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("opencode", args, {
      env: { ...process.env, OPENCODE_ENABLE_EXA: "1" },
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`OpenCode websearch timed out after ${timeoutMs} ms.`));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timeout);
      if (error.code === "ENOENT") {
        reject(new Error("OpenCode is not installed or not on PATH. Install OpenCode, then rerun with --search-provider opencode-web."));
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`OpenCode websearch failed with exit code ${code}: ${stderr.slice(0, 1000)}`));
        return;
      }
      resolve(stdout);
    });
  });
}

