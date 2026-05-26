import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { chat, extractUsage } from "../providers/xiaomi.js";
import type { Plan, ResearchFocus, ResearchProfile, SearchTask, XiaomiUsage } from "../types.js";
import { extractJsonObject, getAssistantContent } from "./json.js";

const searchTaskSchema = z.object({
  id: z.string(),
  subquestionId: z.string().optional(),
  query: z.string(),
  rationale: z.string().optional(),
  depth: z.coerce.number().int().positive().optional(),
  focus: z.unknown().optional()
});

const planSchema = z.object({
  topic: z.string(),
  objective: z.string(),
  assumptions: z.array(z.string()).default([]),
  subquestions: z.array(
    z.object({
      id: z.string(),
      question: z.string(),
      rationale: z.string().optional()
    })
  ),
  searchTasks: z.array(searchTaskSchema)
});

export type PlannerFocusCoercion = {
  taskId: string;
  originalFocus: string;
  coercedTo: ResearchFocus;
};

export type PlannerResult = {
  plan: Plan;
  usage?: XiaomiUsage;
  parseFailed?: boolean;
  parseError?: string;
  fallbackUsed?: boolean;
  coercions?: PlannerFocusCoercion[];
};

export async function runPlanner(params: {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxCompletionTokens: number;
  prompt: string;
  profile: ResearchProfile;
  focus: ResearchFocus;
  dryRun: boolean;
}): Promise<PlannerResult> {
  if (params.dryRun) {
    return { plan: fallbackPlan(params.prompt, params.profile, params.focus, "Dry-run mode did not call Xiaomi.") };
  }

  const system = await readFile(path.resolve("src/prompts/planner.md"), "utf8");
  const desiredTaskCount = Math.max(
    params.profile.initialSubquestions,
    Math.min(Math.ceil(params.profile.targetUniqueSources / params.profile.limit), params.profile.initialSubquestions * 4)
  );
  const response = await chat({
    apiKey: params.apiKey,
    baseUrl: params.baseUrl,
    model: params.model,
    maxCompletionTokens: params.maxCompletionTokens,
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: JSON.stringify(
          {
            prompt: params.prompt,
            profile: params.profile,
            focus: params.focus,
            desiredSearchTaskCount: desiredTaskCount
          },
          null,
          2
        )
      }
    ]
  });
  const parsed = parsePlanContent(getAssistantContent(response), {
    prompt: params.prompt,
    profile: params.profile,
    focus: params.focus
  });
  return { ...parsed, usage: extractUsage(response) };
}

export function parsePlanContent(
  content: string,
  params: { prompt: string; profile: ResearchProfile; focus: ResearchFocus }
): PlannerResult {
  try {
    const rawPlan = planSchema.parse(extractJsonObject(content));
    const subquestionIds = new Set(rawPlan.subquestions.map((subquestion) => subquestion.id));
    const defaultSubquestionId = rawPlan.subquestions[0]?.id ?? "SQ001";
    const coercions: PlannerFocusCoercion[] = [];
    const searchTasks: SearchTask[] = rawPlan.searchTasks.map((task, index) => {
      const originalFocus = typeof task.focus === "string" ? task.focus : undefined;
      const focus = originalFocus === "web" || originalFocus === "github" ? originalFocus : params.focus;
      if (originalFocus && originalFocus !== focus) {
        coercions.push({ taskId: task.id, originalFocus, coercedTo: focus });
      }
      const subquestionId = task.subquestionId && subquestionIds.has(task.subquestionId) ? task.subquestionId : defaultSubquestionId;
      return {
        id: task.id,
        subquestionId,
        query: task.query,
        rationale: task.rationale ?? "Planner did not provide a rationale.",
        depth: clampDepth(task.depth ?? 1, params.profile.maxDepth),
        focus
      };
    });

    return {
      plan: {
        topic: rawPlan.topic,
        objective: rawPlan.objective,
        assumptions: rawPlan.assumptions,
        subquestions: rawPlan.subquestions,
        searchTasks
      },
      coercions
    };
  } catch (error) {
    return {
      plan: fallbackPlan(params.prompt, params.profile, params.focus, "Planner returned malformed JSON; deterministic fallback plan was used."),
      parseFailed: true,
      parseError: safeParseError(error),
      fallbackUsed: true,
      coercions: []
    };
  }
}

export function fallbackPlan(prompt: string, profile: ResearchProfile, focus: ResearchFocus, assumption?: string): Plan {
  const topic = prompt.split(/\r?\n/).find((line) => line.trim())?.replace(/^#+\s*/, "").slice(0, 120) || "Research task";
  const subquestions = Array.from({ length: profile.initialSubquestions }, (_, index) => ({
    id: `SQ${String(index + 1).padStart(3, "0")}`,
    question: `${topic}: research angle ${index + 1}`,
    rationale: "Dry-run fallback subquestion."
  }));
  const searchTasks = subquestions.map((subquestion, index) => ({
    id: `T${String(index + 1).padStart(3, "0")}`,
    subquestionId: subquestion.id,
    query: focus === "github" ? `${subquestion.question} site:github.com` : subquestion.question,
    rationale: "Dry-run fallback search task.",
    depth: 1,
    focus
  }));
  return {
    topic,
    objective: "Answer the user's research prompt with sourced evidence.",
    assumptions: [assumption ?? "Fallback planner generated deterministic tasks."],
    subquestions,
    searchTasks
  };
}

function clampDepth(depth: number, maxDepth: number): number {
  return Math.min(Math.max(depth, 1), Math.max(maxDepth, 1));
}

function safeParseError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 240);
}
