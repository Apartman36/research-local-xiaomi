import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { OpenCodeEventParser } from "./parse-opencode-events.js";
import type { SearchProvider, SearchProviderRequest, SearchProviderResult } from "./search-provider.js";

export class OpenCodeWebSearchProvider implements SearchProvider {
  readonly name = "opencode-web" as const;

  constructor(private readonly model?: string) {}

  async search(request: SearchProviderRequest): Promise<SearchProviderResult> {
    const prompt = buildPrompt(request);
    const args = ["run", "--format", "json"];
    const model = this.model ?? process.env.OPENCODE_MODEL;
    if (model) {
      args.push("--model", model);
    }
    args.push(prompt);

    return runOpenCode(args, request.timeoutMs ?? 180_000, request);
  }
}

function buildPrompt(request: SearchProviderRequest): string {
  return [
    "Use websearch exactly once for the provided query.",
    "Do not write files.",
    "Do not use bash.",
    "Do not use subagents.",
    "Do not use the task tool.",
    "Return only sources.",
    "Each source should have title, url, summary if available.",
    `Query: ${request.query}`,
    `Limit: ${request.maxResults}`,
    `Focus: ${request.focus}`
  ].join("\n");
}

function runOpenCode(args: string[], timeoutMs: number, request: SearchProviderRequest): Promise<SearchProviderResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("opencode", args, {
      env: { ...process.env, OPENCODE_ENABLE_EXA: "1" },
      windowsHide: true
    });
    const parser = new OpenCodeEventParser({ taskId: request.taskId, query: request.query });
    let stdoutBuffer = "";
    let stderr = "";
    let earlyExit = false;
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      terminateChild(child);
      reject(new Error(`OpenCode websearch timed out after ${timeoutMs} ms.`));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (parser.addLine(line) && !settled) {
          earlyExit = true;
          settled = true;
          clearTimeout(timeout);
          terminateChild(child);
          resolve(parser.result({ earlyExit }));
          return;
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (error.code === "ENOENT") {
        reject(new Error("OpenCode is not installed or not on PATH. Install OpenCode, then rerun with --search-provider opencode-web."));
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (stdoutBuffer.trim()) {
        parser.addLine(stdoutBuffer);
      }
      if (code !== 0) {
        reject(new Error(`OpenCode websearch failed with exit code ${code}: ${stderr.slice(0, 1000)}`));
        return;
      }
      resolve(parser.result({ earlyExit }));
    });
  });
}

function terminateChild(child: ChildProcessWithoutNullStreams): void {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }, 1000).unref();
}
