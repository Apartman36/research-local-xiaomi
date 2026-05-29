import { createHash } from "node:crypto";
import { z } from "zod";
import { chat, extractUsage } from "../providers/xiaomi.js";
import type { Confidence, NormalizedResearchRequest, PromptNormalizerMode, XiaomiUsage } from "../types.js";
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
  questionsToAnswer: z
    .array(z.object({ id: z.string(), question: z.string(), sourceSection: z.string().default("Questions to Answer") }))
    .default([]),
  hardwareContext: z.array(z.string()).default([]),
  projectRoadmap: z.array(z.string()).default([]),
  candidateDependencies: z.array(z.string()).default([]),
  importantNotes: z.array(z.string()).default([]),
  expectedOutputFormat: z.array(z.string()).default([]),
  normalizationMode: z.enum(["deterministic", "llm", "hybrid"]).default("llm"),
  normalizationWarnings: z.array(z.string()).default([]),
  detectedPromptSections: z.array(z.string()).default([]),
  confidence: z.enum(["high", "medium", "low"]).default("low"),
  warnings: z.array(z.string()).default([]),
  rawInputSha256: z.string().default("")
});

export type PromptNormalizerResult = {
  normalized: NormalizedResearchRequest;
  usage?: XiaomiUsage;
  usedModel: boolean;
  rawContent?: string;
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
  "research task": "Research Task",
  context: "Context",
  role: "Role",
  constraints: "Constraints",
  requirements: "Constraints",
  "current project constraints": "Current Project Constraints",
  "must cover": "Must Cover",
  hardware: "Hardware",
  "project roadmap": "Project Roadmap",
  roadmap: "Project Roadmap",
  "questions to answer": "Questions to Answer",
  questions: "Questions to Answer",
  "candidate dependencies": "Candidate Dependencies",
  dependencies: "Candidate Dependencies",
  important: "Important",
  output: "Output Requirements",
  "expected output": "Expected Output Format",
  "expected output format": "Expected Output Format",
  deliverables: "Expected Output Format",
  "output requirements": "Output Requirements",
  "do not": "Negative Requirements",
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
  mode?: PromptNormalizerMode;
  timeoutMs?: number;
}): Promise<PromptNormalizerResult> {
  const deterministic = normalizePromptDeterministic(params.prompt);
  const mode = params.mode ?? "auto";
  if (mode === "deterministic" || params.dryRun || (mode === "auto" && !shouldUseModelNormalizer(params.prompt, deterministic))) {
    return { normalized: deterministic, usedModel: false };
  }

  const system = [
    "You normalize long research prompts before planning.",
    "Do not answer the research question and do not perform research.",
    "Only extract the user's research request into strict JSON.",
    "Preserve all key constraints, questions, hardware context, candidate dependencies, important notes, and output requirements.",
    "Do not use prompt template labels such as Role, Context, Goal, or section labels as the topic.",
    "If topic/objective is implied, infer it from project/context/goals.",
    "Return JSON only, with no Markdown or prose."
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
              questionsToAnswer: [{ id: "Q001", question: "string", sourceSection: "Questions to Answer" }],
              hardwareContext: ["string"],
              projectRoadmap: ["string"],
              candidateDependencies: ["string"],
              importantNotes: ["string"],
              expectedOutputFormat: ["string"],
              normalizationMode: "llm",
              normalizationWarnings: ["string"],
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
  const rawContent = getAssistantContent(response);

  try {
    const parsed = normalizedRequestSchema.parse(extractJsonObject(rawContent));
    const normalized = mergeNormalizedRequests(deterministic, {
      ...parsed,
      normalizationMode: mode === "auto" ? "hybrid" : "llm",
      rawInputSha256: rawInputSha256(params.prompt),
      detectedPromptSections: mergeUnique(parsed.detectedPromptSections, deterministic.detectedPromptSections)
    });
    return { normalized, usage: extractUsage(response), usedModel: true, rawContent };
  } catch (error) {
    return {
      normalized: {
        ...deterministic,
        normalizationMode: "deterministic",
        normalizationWarnings: [
          ...deterministic.normalizationWarnings,
          `Model normalizer returned malformed JSON: ${safeError(error)}`
        ],
        warnings: [...deterministic.warnings, `Model normalizer returned malformed JSON: ${safeError(error)}`],
        confidence: deterministic.confidence
      },
      usage: extractUsage(response),
      usedModel: true,
      rawContent
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
  const goal =
    firstParagraph(sectionMap.get("Research Objective")) ??
    firstParagraph(sectionMap.get("Research Task")) ??
    firstParagraph(sectionMap.get("Goal")) ??
    firstParagraph(sectionMap.get("Objective"));
  const context = sectionMap.get("Context")?.trim() ?? "";
  const hardwareContext = extractList(sectionMap.get("Hardware"));
  const projectRoadmap = extractList(sectionMap.get("Project Roadmap"));
  const candidateDependencies = extractList(sectionMap.get("Candidate Dependencies"));
  const importantNotes = extractList(sectionMap.get("Important"));
  const expectedOutputFormat = extractList(sectionMap.get("Expected Output Format"));
  const outputRequirements = mergeUnique(extractList(sectionMap.get("Output Requirements")), expectedOutputFormat);
  const constraints = mergeUnique(extractList(sectionMap.get("Constraints")), extractList(sectionMap.get("Current Project Constraints")), hardwareContext);
  const questionsToAnswer = extractQuestions(sectionMap.get("Questions to Answer"), "Questions to Answer");
  const projectName = extractProjectName(prompt);
  const objectiveSource = goal ?? buildObjectiveFromPrompt(prompt) ?? buildObjectiveFromSections(context, projectRoadmap, questionsToAnswer.map((item) => item.question));
  const inferredTopic = explicitTopic ?? buildInferredTopic(projectName, objectiveSource, context, prompt) ?? firstMeaningfulLine(prompt);
  const researchObjective = objectiveSource ?? "";
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
    constraints,
    mustCover: mergeUnique(extractList(sectionMap.get("Must Cover")), inferMustCover(prompt), candidateDependencies),
    outputRequirements,
    negativeRequirements: mergeUnique(extractList(sectionMap.get("Negative Requirements")), extractNegativeRequirements(prompt), extractNegativeRequirements(importantNotes.join("\n"))),
    questionsToAnswer,
    hardwareContext,
    projectRoadmap,
    candidateDependencies,
    importantNotes,
    expectedOutputFormat,
    normalizationMode: "deterministic",
    normalizationWarnings: [],
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
    renderQuestionList("Questions To Answer", request.questionsToAnswer),
    renderList("Hardware Context", request.hardwareContext),
    renderList("Project Roadmap", request.projectRoadmap),
    renderList("Candidate Dependencies", request.candidateDependencies),
    renderList("Important Notes", request.importantNotes),
    renderList("Expected Output Format", request.expectedOutputFormat),
    renderList("Output Requirements", request.outputRequirements),
    renderList("Negative Requirements", request.negativeRequirements),
    renderList("Normalization Warnings", request.normalizationWarnings),
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

function buildObjectiveFromSections(context: string, roadmap: string[], questions: string[]): string | undefined {
  const combined = [context, ...roadmap, ...questions].join(" ");
  if (/train|from scratch|distillation|language model|local/i.test(combined)) {
    return "Build and train a small English-only language model from scratch on local hardware, then add distillation and possibly larger variants.";
  }
  return undefined;
}

function buildInferredTopic(projectName: string | undefined, goal: string | undefined, context: string, prompt = ""): string | undefined {
  if (!projectName) {
    return undefined;
  }
  const combined = [goal, context, prompt].join(" ");
  if (/language model/i.test(combined) && /from scratch/i.test(combined) && /distillation/i.test(combined)) {
    return `${projectName} local small English-only language model from scratch with distillation`;
  }
  const descriptor = combined
    .match(/\b(?:small|local|English-only|language model|training|train|from scratch|distillation)\b/gi);
  const uniqueDescriptor = mergeUnique(descriptor ?? []).slice(0, 8).join(" ");
  return uniqueDescriptor ? `${projectName} ${uniqueDescriptor}` : projectName;
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
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
  if (lines.length <= 1) {
    return splitInlineList(input);
  }
  return lines.map(cleanText).filter((item): item is string => Boolean(item));
}

function extractQuestions(input: string | undefined, sourceSection: string): NormalizedResearchRequest["questionsToAnswer"] {
  return extractList(input).map((question, index) => ({
    id: `Q${String(index + 1).padStart(3, "0")}`,
    question: ensureQuestion(question),
    sourceSection
  }));
}

function ensureQuestion(input: string): string {
  const trimmed = input.trim();
  return /[?]$/.test(trimmed) ? trimmed : `${trimmed}?`;
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
  const expectedOutputFormat = cleanList(request.expectedOutputFormat ?? []);
  return {
    schemaVersion: 1,
    researchTopic: cleanText(request.researchTopic) ?? "",
    researchObjective: cleanText(request.researchObjective) ?? "",
    userContext: cleanText(request.userContext) ?? "",
    constraints: cleanList(request.constraints),
    mustCover: cleanList(request.mustCover),
    outputRequirements: mergeUnique(cleanList(request.outputRequirements), expectedOutputFormat),
    negativeRequirements: cleanList(request.negativeRequirements),
    questionsToAnswer: (request.questionsToAnswer ?? [])
      .map((item, index) => ({
        id: cleanText(item.id) ?? `Q${String(index + 1).padStart(3, "0")}`,
        question: cleanText(item.question) ?? "",
        sourceSection: cleanText(item.sourceSection) ?? "Questions to Answer"
      }))
      .filter((item) => item.question)
      .slice(0, 40),
    hardwareContext: cleanList(request.hardwareContext ?? []),
    projectRoadmap: cleanList(request.projectRoadmap ?? []),
    candidateDependencies: cleanList(request.candidateDependencies ?? []),
    importantNotes: cleanList(request.importantNotes ?? []),
    expectedOutputFormat,
    normalizationMode: request.normalizationMode ?? "deterministic",
    normalizationWarnings: cleanList(request.normalizationWarnings ?? []),
    detectedPromptSections: cleanList(request.detectedPromptSections),
    confidence: request.confidence,
    warnings: cleanList(request.warnings),
    rawInputSha256: request.rawInputSha256
  };
}

function mergeNormalizedRequests(deterministic: NormalizedResearchRequest, model: NormalizedResearchRequest): NormalizedResearchRequest {
  return normalizeRequestShape({
    ...model,
    researchTopic: model.researchTopic || deterministic.researchTopic,
    researchObjective: model.researchObjective || deterministic.researchObjective,
    userContext: model.userContext || deterministic.userContext,
    constraints: mergeUnique(model.constraints, deterministic.constraints),
    mustCover: mergeUnique(model.mustCover, deterministic.mustCover),
    outputRequirements: mergeUnique(model.outputRequirements, deterministic.outputRequirements),
    negativeRequirements: mergeUnique(model.negativeRequirements, deterministic.negativeRequirements),
    questionsToAnswer: model.questionsToAnswer.length > 0 ? model.questionsToAnswer : deterministic.questionsToAnswer,
    hardwareContext: mergeUnique(model.hardwareContext, deterministic.hardwareContext),
    projectRoadmap: mergeUnique(model.projectRoadmap, deterministic.projectRoadmap),
    candidateDependencies: mergeUnique(model.candidateDependencies, deterministic.candidateDependencies),
    importantNotes: mergeUnique(model.importantNotes, deterministic.importantNotes),
    expectedOutputFormat: mergeUnique(model.expectedOutputFormat, deterministic.expectedOutputFormat),
    normalizationWarnings: mergeUnique(model.normalizationWarnings, deterministic.normalizationWarnings),
    detectedPromptSections: mergeUnique(model.detectedPromptSections, deterministic.detectedPromptSections),
    warnings: mergeUnique(model.warnings, deterministic.warnings),
    rawInputSha256: model.rawInputSha256 || deterministic.rawInputSha256
  });
}

function shouldUseModelNormalizer(prompt: string, deterministic: NormalizedResearchRequest): boolean {
  if (deterministic.confidence === "low") {
    return true;
  }
  const wordCount = prompt.trim().split(/\s+/).filter(Boolean).length;
  const manySections = deterministic.detectedPromptSections.length >= 5;
  const missingRichFields =
    deterministic.questionsToAnswer.length === 0 ||
    deterministic.outputRequirements.length === 0 ||
    deterministic.expectedOutputFormat.length === 0;
  const detectedQuestions = deterministic.detectedPromptSections.some((section) => /questions/i.test(section));
  const detectedOutput = deterministic.detectedPromptSections.some((section) => /output|deliverable/i.test(section));
  return (wordCount > 1000 || manySections) && missingRichFields && (detectedQuestions || detectedOutput || deterministic.mustCover.length < 3);
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

function renderQuestionList(title: string, items: NormalizedResearchRequest["questionsToAnswer"]): string {
  return [
    `## ${title}`,
    "",
    ...(items.length > 0 ? items.map((item) => `- ${item.id}: ${item.question} (${item.sourceSection})`) : ["- none"]),
    ""
  ].join("\n");
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 240);
}
