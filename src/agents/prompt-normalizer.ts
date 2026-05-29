import { createHash } from "node:crypto";
import { z } from "zod";
import { chat, extractUsage } from "../providers/xiaomi.js";
import type { Confidence, NormalizedResearchRequest, XiaomiUsage } from "../types.js";
import { extractJsonObject, getAssistantContent } from "./json.js";

const normalizedRequestSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  researchTopic: z.string().default(""),
  researchObjective: z.string().default(""),
  userContext: z.string().default(""),
  constraints: z.array(z.string()).default([]),
  mustCover: z.array(z.string()).default([]),
  outputRequirements: z.array(z.string()).default([]),
  negativeRequirements: z.array(z.string()).default([]),
  detectedPromptSections: z.array(z.string()).default([]),
  confidence: z.enum(["high", "medium", "low"]).default("low"),
  warnings: z.array(z.string()).default([]),
  rawInputSha256: z.string().default("")
});

export type PromptNormalizerResult = {
  normalized: NormalizedResearchRequest;
  usage?: XiaomiUsage;
  usedModel: boolean;
};

type Section = {
  label: string;
  content: string[];
};

const SECTION_ALIASES: Record<string, string> = {
  title: "Research Topic",
  topic: "Research Topic",
  "research topic": "Research Topic",
  objective: "Research Objective",
  "research objective": "Research Objective",
  goal: "Goal",
  context: "Context",
  role: "Role",
  constraints: "Constraints",
  "must cover": "Must Cover",
  "output requirements": "Output Requirements",
  "negative requirements": "Negative Requirements",
  "original prompt": "Original Prompt"
};

const IMPORTANT_TERMS = [
  "PyTorch",
  "CUDA",
  "NVIDIA Blackwell",
  "Blackwell",
  "WSL2",
  "datasets",
  "tokenizer",
  "memory",
  "checkpointing",
  "evaluation",
  "distillation"
];

const PREFLIGHT_ERROR_MESSAGE =
  "The research prompt could not be normalized into a concrete topic/objective.\n" +
  "The input appears to contain role/context instructions but no extracted research topic.\n" +
  "Please add a # Research Topic and # Research Objective heading, or inspect normalized_request.json.";

export class PromptPreflightError extends Error {
  constructor(
    message = PREFLIGHT_ERROR_MESSAGE,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "PromptPreflightError";
  }
}

export async function runPromptNormalizer(params: {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxCompletionTokens: number;
  prompt: string;
  dryRun: boolean;
  timeoutMs?: number;
}): Promise<PromptNormalizerResult> {
  const deterministic = normalizePromptDeterministic(params.prompt);
  if (deterministic.confidence !== "low" || params.dryRun) {
    return { normalized: deterministic, usedModel: false };
  }

  const system = [
    "You normalize long research prompts before planning.",
    "Extract the user's actual research topic and objective.",
    "Do not use prompt template labels such as Role, Context, or Goal as the topic.",
    "Return only JSON matching the requested schema."
  ].join("\n");
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
            schema: {
              schemaVersion: 1,
              researchTopic: "string",
              researchObjective: "string",
              userContext: "string",
              constraints: ["string"],
              mustCover: ["string"],
              outputRequirements: ["string"],
              negativeRequirements: ["string"],
              detectedPromptSections: ["Role", "Context", "Goal", "Output Requirements"],
              confidence: "high | medium | low",
              warnings: ["string"],
              rawInputSha256: rawInputSha256(params.prompt)
            },
            deterministicCandidate: deterministic,
            originalPrompt: params.prompt
          },
          null,
          2
        )
      }
    ]
  });

  try {
    const parsed = normalizedRequestSchema.parse(extractJsonObject(getAssistantContent(response)));
    const normalized = normalizeRequestShape({
      ...parsed,
      rawInputSha256: rawInputSha256(params.prompt),
      detectedPromptSections: mergeUnique(parsed.detectedPromptSections, deterministic.detectedPromptSections)
    });
    return { normalized, usage: extractUsage(response), usedModel: true };
  } catch (error) {
    return {
      normalized: {
        ...deterministic,
        warnings: [...deterministic.warnings, `Model normalizer returned malformed JSON: ${safeError(error)}`],
        confidence: deterministic.confidence
      },
      usage: extractUsage(response),
      usedModel: true
    };
  }
}

export function normalizePromptDeterministic(prompt: string): NormalizedResearchRequest {
  const sections = parseSections(prompt);
  const sectionMap = new Map<string, string>();
  for (const section of sections) {
    const existing = sectionMap.get(section.label);
    const content = section.content.join("\n").trim();
    sectionMap.set(section.label, existing ? `${existing}\n${content}`.trim() : content);
  }

  const explicitTopic =
    firstParagraph(sectionMap.get("Research Topic")) ??
    firstParagraph(sectionMap.get("Title")) ??
    firstParagraph(sectionMap.get("Topic"));
  const goal = firstParagraph(sectionMap.get("Research Objective")) ?? firstParagraph(sectionMap.get("Goal")) ?? firstParagraph(sectionMap.get("Objective"));
  const context = sectionMap.get("Context")?.trim() ?? "";
  const projectName = extractProjectName(prompt);
  const inferredTopic = explicitTopic ?? buildInferredTopic(projectName, goal, context) ?? firstMeaningfulLine(prompt);
  const researchObjective = goal ?? buildObjectiveFromPrompt(prompt) ?? "";
  const warnings: string[] = [];

  if (!explicitTopic && projectName) {
    warnings.push("Research topic was inferred from project/context text.");
  }
  if (!explicitTopic && !projectName) {
    warnings.push("Research topic was inferred heuristically; add # Research Topic for best reliability.");
  }
  if (!researchObjective) {
    warnings.push("Research objective was not explicit; add # Research Objective for best reliability.");
  }

  const confidence = scoreConfidence({
    prompt,
    explicitTopic,
    projectName,
    objective: researchObjective,
    topic: inferredTopic
  });

  return normalizeRequestShape({
    schemaVersion: 1,
    researchTopic: inferredTopic ?? "",
    researchObjective,
    userContext: context || firstParagraph(prompt) || "",
    constraints: extractList(sectionMap.get("Constraints")),
    mustCover: mergeUnique(extractList(sectionMap.get("Must Cover")), inferMustCover(prompt)),
    outputRequirements: extractList(sectionMap.get("Output Requirements")),
    negativeRequirements: mergeUnique(extractList(sectionMap.get("Negative Requirements")), extractNegativeRequirements(prompt)),
    detectedPromptSections: sections.map((section) => section.label),
    confidence,
    warnings,
    rawInputSha256: rawInputSha256(prompt)
  });
}

export function validateNormalizedRequest(request: NormalizedResearchRequest): void {
  const topic = request.researchTopic.trim();
  const generic = new Set(["role", "role:", "context", "context:", "goal", "goal:"]);
  const failures: string[] = [];
  if (!topic) {
    failures.push("researchTopic is empty");
  }
  if (generic.has(topic.toLowerCase())) {
    failures.push(`researchTopic is a prompt-section label: ${topic}`);
  }
  if (topic.length < 8 && !/[?]$/.test(topic)) {
    failures.push("researchTopic is too short");
  }
  if (request.confidence === "low") {
    failures.push("normalizer confidence is low");
  }
  if (failures.length > 0) {
    throw new PromptPreflightError(PREFLIGHT_ERROR_MESSAGE, { failures });
  }
}

export function validatePlanPreflight(plan: {
  topic: string;
  subquestions: Array<{ question: string }>;
  searchTasks: Array<{ query: string }>;
}): void {
  const values = [
    plan.topic,
    ...plan.subquestions.map((item) => item.question),
    ...plan.searchTasks.map((item) => item.query)
  ];
  const placeholder = /(?:^|\b)(?:research angle\s*\d+|angle\s*\d+|<topic>::\s*research angle|Role::|Context::)/i;
  const matched = values.find((value) => placeholder.test(value));
  if (matched) {
    throw new PromptPreflightError(PREFLIGHT_ERROR_MESSAGE, { failures: ["planner generated placeholder subquestions"], matched });
  }
}

export function renderNormalizedRequestMarkdown(request: NormalizedResearchRequest): string {
  return [
    "# Normalized Research Request",
    "",
    `- Confidence: ${request.confidence}`,
    `- Raw input SHA-256: ${request.rawInputSha256}`,
    `- Detected sections: ${request.detectedPromptSections.length > 0 ? request.detectedPromptSections.join(", ") : "none"}`,
    "",
    "## Research Topic",
    "",
    request.researchTopic || "unavailable",
    "",
    "## Research Objective",
    "",
    request.researchObjective || "unavailable",
    "",
    "## User Context",
    "",
    request.userContext || "unavailable",
    "",
    renderList("Must Cover", request.mustCover),
    renderList("Constraints", request.constraints),
    renderList("Output Requirements", request.outputRequirements),
    renderList("Negative Requirements", request.negativeRequirements),
    renderList("Warnings", request.warnings)
  ].join("\n");
}

function parseSections(prompt: string): Section[] {
  const sections: Section[] = [];
  let current: Section | undefined;
  for (const rawLine of prompt.split(/\r?\n/)) {
    const heading = parseHeading(rawLine);
    if (heading) {
      current = { label: heading, content: [] };
      sections.push(current);
      continue;
    }
    if (!current) {
      current = { label: "Original Prompt", content: [] };
      sections.push(current);
    }
    current.content.push(rawLine);
  }
  return sections.filter((section) => section.label !== "Original Prompt" || section.content.some((line) => line.trim()));
}

function parseHeading(line: string): string | undefined {
  const trimmed = line.trim();
  const markdown = /^#{1,6}\s+(.+?)\s*$/.exec(trimmed);
  const label = markdown?.[1] ?? /^([A-Za-z][A-Za-z ]{1,40}):\s*$/.exec(trimmed)?.[1];
  if (!label) {
    return undefined;
  }
  const canonical = SECTION_ALIASES[label.trim().toLowerCase()];
  return canonical ?? label.trim().replace(/:$/, "");
}

function firstParagraph(input: string | undefined): string | undefined {
  const paragraph = input
    ?.split(/\n\s*\n/)
    .map((item) => item.trim())
    .find(Boolean);
  return cleanText(paragraph);
}

function firstMeaningfulLine(prompt: string): string | undefined {
  for (const line of prompt.split(/\r?\n/)) {
    const cleaned = cleanText(line);
    if (cleaned && !/^(role|context|goal|objective|research topic):?$/i.test(cleaned)) {
      return cleaned;
    }
  }
  return undefined;
}

function buildObjectiveFromPrompt(prompt: string): string | undefined {
  const line = prompt
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => /\b(goal|objective|build|train|evaluate|research|compare|decide)\b/i.test(item) && !/^(role|context):?$/i.test(item));
  return cleanText(line);
}

function buildInferredTopic(projectName: string | undefined, goal: string | undefined, context: string): string | undefined {
  if (!projectName) {
    return undefined;
  }
  const descriptor = [goal, context]
    .filter(Boolean)
    .join(" ")
    .match(/\b(?:small|local|English-only|language model|training|from scratch|distillation)\b/gi)
    ?.slice(0, 6)
    .join(" ");
  return descriptor ? `${projectName} ${descriptor}` : projectName;
}

function extractProjectName(prompt: string): string | undefined {
  const called = /\b(?:called|named)\s+([A-Z][A-Z0-9]+(?:-[A-Z0-9]+)+)\b/.exec(prompt);
  if (called?.[1]) {
    return called[1];
  }
  const candidates = [...prompt.matchAll(/\b([A-Z][A-Z0-9]+(?:-[A-Z0-9]+)+)\b/g)]
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value));
  return candidates.find((value) => /LM|MODEL|APP|CLI|GPU/i.test(value)) ?? candidates[0];
}

function extractList(input: string | undefined): string[] {
  if (!input) {
    return [];
  }
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*]\s+/, "").trim())
    .filter(Boolean);
  if (lines.length <= 1) {
    return splitInlineList(input);
  }
  return lines.map(cleanText).filter((item): item is string => Boolean(item));
}

function splitInlineList(input: string): string[] {
  return input
    .split(/[,;]\s*/)
    .map(cleanText)
    .filter((item): item is string => Boolean(item));
}

function inferMustCover(prompt: string): string[] {
  return IMPORTANT_TERMS.filter((term) => new RegExp(`\\b${escapeRegExp(term)}\\b`, "i").test(prompt));
}

function extractNegativeRequirements(prompt: string): string[] {
  return prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(do not|don't|avoid|must not)\b/i.test(line))
    .map(cleanText)
    .filter((item): item is string => Boolean(item));
}

function scoreConfidence(params: {
  prompt: string;
  explicitTopic: string | undefined;
  projectName: string | undefined;
  objective: string;
  topic: string | undefined;
}): Confidence {
  if (params.explicitTopic && params.objective) {
    return "high";
  }
  if (params.projectName && params.objective) {
    return "high";
  }
  if (params.topic && params.objective && !/^\s*(role|context|goal):?\s*$/i.test(params.topic)) {
    return "medium";
  }
  if (/^\s*(role|context):\s*$/im.test(params.prompt)) {
    return "low";
  }
  return "medium";
}

function normalizeRequestShape(request: NormalizedResearchRequest): NormalizedResearchRequest {
  return {
    schemaVersion: 1,
    researchTopic: cleanText(request.researchTopic) ?? "",
    researchObjective: cleanText(request.researchObjective) ?? "",
    userContext: cleanText(request.userContext) ?? "",
    constraints: cleanList(request.constraints),
    mustCover: cleanList(request.mustCover),
    outputRequirements: cleanList(request.outputRequirements),
    negativeRequirements: cleanList(request.negativeRequirements),
    detectedPromptSections: cleanList(request.detectedPromptSections),
    confidence: request.confidence,
    warnings: cleanList(request.warnings),
    rawInputSha256: request.rawInputSha256
  };
}

function cleanList(values: string[]): string[] {
  return mergeUnique(values.map(cleanText).filter((value): value is string => Boolean(value))).slice(0, 40);
}

function mergeUnique(...lists: string[][]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const item of lists.flat()) {
    const normalized = item.trim();
    const key = normalized.toLowerCase();
    if (normalized && !seen.has(key)) {
      seen.add(key);
      merged.push(normalized);
    }
  }
  return merged;
}

function cleanText(input: string | undefined): string | undefined {
  const cleaned = input?.replace(/^\s*[-*]\s+/, "").replace(/\s+/g, " ").trim();
  return cleaned || undefined;
}

function rawInputSha256(prompt: string): string {
  return createHash("sha256").update(prompt, "utf8").digest("hex");
}

function renderList(title: string, items: string[]): string {
  return [`## ${title}`, "", ...(items.length > 0 ? items.map((item) => `- ${item}`) : ["- none"]), ""].join("\n");
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 240);
}
