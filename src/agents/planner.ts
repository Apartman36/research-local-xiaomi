import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { chat, extractUsage } from "../providers/xiaomi.js";
import type { NormalizedResearchRequest, Plan, PlannerDiagnostics, PlannerParseStatus, ResearchFocus, ResearchProfile, SearchTask, XiaomiUsage } from "../types.js";
import { getAssistantContent } from "./json.js";

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
  parseStatus?: PlannerParseStatus;
  parseFailed?: boolean;
  parseError?: string;
  fallbackUsed?: boolean;
  rawContent?: string;
  diagnostics?: PlannerDiagnostics;
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
  normalizedRequest?: NormalizedResearchRequest;
  dryRun: boolean;
  timeoutMs?: number;
}): Promise<PlannerResult> {
  if (params.dryRun) {
    return { plan: fallbackPlan(params.prompt, params.profile, params.focus, "Dry-run mode did not call Xiaomi.", params.normalizedRequest) };
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
    timeoutMs: params.timeoutMs,
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: JSON.stringify(
          {
            prompt: params.prompt,
            normalizedResearchRequest: params.normalizedRequest
              ? {
                  researchTopic: params.normalizedRequest.researchTopic,
                  researchObjective: params.normalizedRequest.researchObjective,
                  userContext: params.normalizedRequest.userContext,
                  mustCover: params.normalizedRequest.mustCover,
                  constraints: params.normalizedRequest.constraints,
                  outputRequirements: params.normalizedRequest.outputRequirements,
                  negativeRequirements: params.normalizedRequest.negativeRequirements,
                  questionsToAnswer: params.normalizedRequest.questionsToAnswer,
                  hardwareContext: params.normalizedRequest.hardwareContext,
                  expectedOutputFormat: params.normalizedRequest.expectedOutputFormat,
                  candidateDependencies: params.normalizedRequest.candidateDependencies,
                  importantNotes: params.normalizedRequest.importantNotes,
                  confidence: params.normalizedRequest.confidence
                }
              : undefined,
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
    focus: params.focus,
    normalizedRequest: params.normalizedRequest
  });
  return { ...parsed, usage: extractUsage(response) };
}

export function parsePlanContent(
  content: string,
  params: { prompt: string; profile: ResearchProfile; focus: ResearchFocus; normalizedRequest?: NormalizedResearchRequest }
): PlannerResult {
  const parsedJson = parsePlannerJson(content);
  try {
    const rawPlan = planSchema.parse(parsedJson.value);
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
      parseStatus: parsedJson.status,
      coercions
    };
  } catch (error) {
    const parseError = safeParseError(parsedJson.error ?? error);
    const diagnostics = buildPlannerDiagnostics("fallback", true, "malformed_json", params.normalizedRequest, [
      `Planner returned malformed JSON: ${parseError}`
    ]);
    return {
      plan: fallbackPlan(
        params.prompt,
        params.profile,
        params.focus,
        "Planner returned malformed JSON; deterministic fallback plan was used.",
        params.normalizedRequest
      ),
      parseStatus: "fallback",
      parseFailed: true,
      parseError,
      fallbackUsed: true,
      rawContent: content,
      diagnostics,
      coercions: []
    };
  }
}

export function fallbackPlan(
  prompt: string,
  profile: ResearchProfile,
  focus: ResearchFocus,
  assumption?: string,
  normalizedRequest?: NormalizedResearchRequest
): Plan {
  const topic = normalizedRequest?.researchTopic || prompt.split(/\r?\n/).find((line) => line.trim())?.replace(/^#+\s*/, "").slice(0, 120) || "Research task";
  const objective = normalizedRequest?.researchObjective || "Answer the user's research prompt with sourced evidence.";
  const templates = fallbackQuestionTemplates(topic, objective, normalizedRequest);
  const desiredCount = normalizedRequest?.questionsToAnswer.length
    ? Math.min(12, Math.max(6, normalizedRequest.questionsToAnswer.length))
    : Math.min(12, Math.max(6, profile.initialSubquestions));
  const subquestions = templates.slice(0, desiredCount).map((question, index) => ({
    id: `SQ${String(index + 1).padStart(3, "0")}`,
    question,
    rationale: "Generated from normalized prompt coverage requirements."
  }));
  const searchTasks = subquestions.map((subquestion, index) => ({
    id: `T${String(index + 1).padStart(3, "0")}`,
    subquestionId: subquestion.id,
    query: buildFallbackQuery(subquestion.question, topic, focus),
    rationale: "Search query generated from a concrete normalized subquestion.",
    depth: 1,
    focus
  }));
  return {
    topic,
    objective,
    assumptions: [assumption ?? "Fallback planner generated deterministic tasks."],
    subquestions,
    searchTasks
  };
}

function fallbackQuestionTemplates(topic: string, objective: string, normalizedRequest?: NormalizedResearchRequest): string[] {
  const questions = normalizedRequest?.questionsToAnswer.map((item) => item.question) ?? [];
  if (questions.length > 0) {
    return dedupeSimilar(questions);
  }
  const mustCover = normalizedRequest?.mustCover ?? [];
  const joined = `${topic} ${objective} ${mustCover.join(" ")}`;
  if (/SARYCH-LM|Blackwell|WSL2|tokenizer|distillation|language model/i.test(joined)) {
    return [
      "What PyTorch, CUDA, NVIDIA Blackwell, and WSL2 versions currently support local training workloads?",
      "What model size is realistic for training a small English-only language model from scratch on the user's local hardware?",
      "What dataset mix and token budget are appropriate for a small English-only language model MVP?",
      "What tokenizer strategy and vocabulary size should SARYCH-LM start with?",
      "What minimal Transformer architecture should be implemented first?",
      "What training loop, checkpointing, mixed precision, and memory optimization choices are required?",
      "What evaluation metrics and benchmarks are realistic for a small local English-only language model?",
      "What distillation strategy should be added after baseline pretraining?",
      "What are the biggest risks and failure modes in local from-scratch language model training?",
      "What concrete implementation roadmap should be followed for SARYCH-LM?"
    ];
  }
  const coverage = mustCover.slice(0, 8);
  const generated = coverage.map((item) => `What current evidence and implementation guidance is needed for ${item} in ${topic}?`);
  generated.push(`What constraints, risks, and tradeoffs affect ${topic}?`);
  generated.push(`What implementation roadmap follows from the objective: ${objective}?`);
  return dedupeSimilar(generated);
}

export function validatePlanQuality(plan: Plan, normalizedRequest?: NormalizedResearchRequest): void {
  const failures: string[] = [];
  const values = [plan.topic, ...plan.subquestions.map((item) => item.question), ...plan.searchTasks.map((item) => item.query)];
  if (/^\s*(role|context|goal):?\s*$/i.test(plan.topic)) {
    failures.push("topic is generic or a prompt-section label");
  }
  if (values.some((value) => /research angle|Role::|Context::|Dry-run fallback subquestion/i.test(value))) {
    failures.push("plan contains placeholder planner text");
  }
  if (duplicateRatio(plan.subquestions.map((item) => item.question)) > 0.3) {
    failures.push("more than 30% of subquestions are near-duplicates");
  }
  if (duplicateRatio(plan.searchTasks.map((item) => item.query)) > 0.3) {
    failures.push("more than 30% of search tasks are near-duplicates");
  }
  const genericCount = plan.subquestions.filter((item) =>
    /what concrete decisions are required|what evidence is needed|constraints, risks, and tradeoffs|implementation roadmap follows/i.test(item.question)
  ).length;
  if (genericCount > Math.max(1, Math.floor(plan.subquestions.length * 0.3))) {
    failures.push("subquestions are repeated generic templates");
  }
  if ((normalizedRequest?.questionsToAnswer.length ?? 0) > 0) {
    const covered = normalizedRequest!.questionsToAnswer.filter((question) =>
      plan.subquestions.some((subquestion) => tokenOverlap(question.question, subquestion.question) >= 0.35)
    ).length;
    if (covered < Math.min(normalizedRequest!.questionsToAnswer.length, Math.max(3, Math.floor(plan.subquestions.length * 0.5)))) {
      failures.push("plan ignores questionsToAnswer");
    }
  }
  if ((normalizedRequest?.mustCover.length ?? 0) > 0) {
    const planText = values.join(" ").toLowerCase();
    const covered = normalizedRequest!.mustCover.filter((item) => planText.includes(item.toLowerCase())).length;
    if (covered < Math.min(3, normalizedRequest!.mustCover.length)) {
      failures.push("plan ignores mustCover");
    }
  }
  if (failures.length > 0) {
    throw new Error(`planner_quality_failed: ${failures.join("; ")}`);
  }
}

export function buildPlannerDiagnostics(
  parseStatus: PlannerParseStatus,
  fallbackUsed: boolean,
  fallbackReason: string | undefined,
  normalizedRequest: NormalizedResearchRequest | undefined,
  warnings: string[] = []
): PlannerDiagnostics {
  return {
    schemaVersion: 1,
    parseStatus,
    rawOutputPath: fallbackUsed ? "./planner_raw.txt" : undefined,
    warnings,
    fallbackUsed,
    fallbackReason,
    normalizedRequestSummary: {
      topic: normalizedRequest?.researchTopic ?? "",
      questionsToAnswerCount: normalizedRequest?.questionsToAnswer.length ?? 0,
      mustCoverCount: normalizedRequest?.mustCover.length ?? 0,
      constraintsCount: normalizedRequest?.constraints.length ?? 0
    }
  };
}

function parsePlannerJson(content: string): { value: unknown; status: PlannerParseStatus; error?: unknown } {
  const candidates = [
    { text: content.trim(), repaired: false },
    ...extractFencedJson(content).map((text) => ({ text, repaired: true })),
    ...extractBalancedJsonObjects(content).map((text) => ({ text, repaired: true }))
  ];
  let lastError: unknown;
  for (const candidate of candidates) {
    if (!candidate.text) {
      continue;
    }
    for (const text of [candidate.text, repairSimpleJson(candidate.text)]) {
      try {
        return { value: JSON.parse(text), status: candidate.repaired || text !== candidate.text ? "repaired" : "parsed" };
      } catch (error) {
        lastError = error;
      }
    }
  }
  return { value: undefined, status: "failed", error: lastError ?? new Error("Could not extract planner JSON.") };
}

function extractFencedJson(content: string): string[] {
  return [...content.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1] ?? "");
}

function extractBalancedJsonObjects(content: string): string[] {
  const candidates: string[] = [];
  for (let start = content.indexOf("{"); start >= 0; start = content.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < content.length; index += 1) {
      const char = content[index];
      if (inString) {
        escaped = char === "\\" && !escaped;
        if (char === "\"" && !escaped) {
          inString = false;
        }
        if (char !== "\\") {
          escaped = false;
        }
        continue;
      }
      if (char === "\"") {
        inString = true;
      } else if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          candidates.push(content.slice(start, index + 1));
          break;
        }
      }
    }
  }
  return candidates;
}

function repairSimpleJson(text: string): string {
  return text.replace(/,\s*([}\]])/g, "$1").trim();
}

function buildFallbackQuery(question: string, topic: string, focus: ResearchFocus): string {
  const cleaned = question.replace(/[?]/g, "").trim();
  const topicPrefix = topic && !cleaned.toLowerCase().includes(topic.toLowerCase()) ? `${topic} ` : "";
  const query = `${topicPrefix}${cleaned}`.replace(/\s+/g, " ").slice(0, 180);
  return focus === "github" ? `${query} site:github.com` : query;
}

function dedupeSimilar(items: string[]): string[] {
  const result: string[] = [];
  for (const item of items) {
    if (!result.some((existing) => normalizeForDedupe(existing) === normalizeForDedupe(item) || tokenOverlap(existing, item) > 0.85)) {
      result.push(item);
    }
  }
  return result;
}

function duplicateRatio(items: string[]): number {
  if (items.length <= 1) {
    return 0;
  }
  return (items.length - dedupeSimilar(items).length) / items.length;
}

function normalizeForDedupe(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function tokenOverlap(a: string, b: string): number {
  const aTokens = new Set(normalizeForDedupe(a).split(" ").filter((token) => token.length > 3));
  const bTokens = new Set(normalizeForDedupe(b).split(" ").filter((token) => token.length > 3));
  if (aTokens.size === 0 || bTokens.size === 0) {
    return 0;
  }
  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  return intersection / Math.min(aTokens.size, bTokens.size);
}

function clampDepth(depth: number, maxDepth: number): number {
  return Math.min(Math.max(depth, 1), Math.max(maxDepth, 1));
}

function safeParseError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 240);
}
