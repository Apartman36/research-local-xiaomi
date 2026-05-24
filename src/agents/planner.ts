import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { chat, extractUsage } from "../providers/xiaomi.js";
import type { Plan, ResearchFocus, ResearchProfile, XiaomiUsage } from "../types.js";
import { extractJsonObject, getAssistantContent } from "./json.js";

const searchTaskSchema = z.object({
  id: z.string(),
  subquestionId: z.string(),
  query: z.string(),
  rationale: z.string().optional(),
  depth: z.number().int().positive().default(1),
  focus: z.enum(["web", "github"])
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

export async function runPlanner(params: {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxCompletionTokens: number;
  prompt: string;
  profile: ResearchProfile;
  focus: ResearchFocus;
  dryRun: boolean;
}): Promise<{ plan: Plan; usage?: XiaomiUsage }> {
  if (params.dryRun) {
    return { plan: fallbackPlan(params.prompt, params.profile, params.focus) };
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
  const parsed = planSchema.parse(extractJsonObject(getAssistantContent(response)));
  return { plan: parsed, usage: extractUsage(response) };
}

function fallbackPlan(prompt: string, profile: ResearchProfile, focus: ResearchFocus): Plan {
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
    assumptions: ["Dry-run mode did not call Xiaomi."],
    subquestions,
    searchTasks
  };
}
