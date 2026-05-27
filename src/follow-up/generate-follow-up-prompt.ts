import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Critique, Plan, ReportReview, SearchTask } from "../types.js";
import { writeTextArtifact } from "../store/run-store.js";

const ARTIFACTS = [
  "run_summary.md",
  "report_review.json",
  "report_review.md",
  "critique.json",
  "report.md",
  "plan.json",
  "input.md"
] as const;

type FollowUpContext = {
  runDir: string;
  runId: string;
  runSummary?: string;
  reportReview?: ReportReview;
  reportReviewMarkdown?: string;
  critique?: Critique;
  report?: string;
  plan?: Plan;
  input?: string;
  missingArtifacts: string[];
};

export type WriteFollowUpPromptResult = {
  path: string;
  prompt: string;
  missingArtifacts: string[];
  followUpReason: string;
  gapsAddressed: string[];
};

export async function writeFollowUpPrompt(runDir: string): Promise<WriteFollowUpPromptResult> {
  await assertDirectoryExists(runDir);
  const context = await loadFollowUpContext(runDir);
  const prompt = generateFollowUpPrompt(context);
  const promptPath = path.join(runDir, "follow_up_prompt.md");
  await writeTextArtifact(runDir, "follow_up_prompt.md", prompt);
  return {
    path: promptPath,
    prompt,
    missingArtifacts: context.missingArtifacts,
    followUpReason: followUpReason(context),
    gapsAddressed: topGaps(context)
  };
}

export function generateFollowUpPrompt(context: FollowUpContext): string {
  const reason = followUpReason(context);
  const gaps = topGaps(context);
  const recommendations = topRecommendations(context);
  const followUpTasks = topFollowUpTasks(context);
  const nextActions = nextSuggestedActions(context.runSummary);
  const uncovered = uncoveredSubquestions(context);
  const questions = followUpQuestions(gaps, followUpTasks, uncovered);

  return [
    "# Follow-Up Research Task",
    "",
    "## Parent Run",
    "",
    `- Parent run ID: ${context.runId}`,
    `- parentRunId: ${context.runId}`,
    `- Parent report: ${artifactRef(context, "report.md")}`,
    `- Parent summary: ${artifactRef(context, "run_summary.md")}`,
    `- Reason for follow-up: ${reason}`,
    "",
    "## What Was Already Covered",
    "",
    ...coveredAreas(context).map((item) => `- ${item}`),
    "",
    "## Gaps To Address",
    "",
    ...listOrUnavailable(gaps),
    "",
    "## Follow-Up Research Questions",
    "",
    ...listOrUnavailable(questions),
    "",
    "## Source Requirements",
    "",
    "- Prefer primary documentation and official API references.",
    "- Prefer official GitHub repositories for implementation details.",
    "- Prefer issues, discussions, changelogs, and release notes for failure modes.",
    "- Avoid repeating already-covered vendor docs unless needed to verify a specific claim.",
    "- Include source quality notes and call out marketing-heavy or weak evidence.",
    "",
    "## Output Requirements",
    "",
    "- Produce a detailed report with citations.",
    "- Provide concrete implementation recommendations for a TypeScript/Node CLI.",
    "- Include a source quality table.",
    "- Include a coverage matrix mapping questions to evidence.",
    "- Include suggested follow-up queries.",
    "- Include Codex implementation implications and human approval checkpoints.",
    "",
    "## Constraints",
    "",
    "- Do not recommend autonomous self-modification.",
    "- Keep human approval gates.",
    "- Focus on practical TypeScript/Node CLI implementation.",
    "- Report language: English.",
    "",
    "## Prior Context Signals",
    "",
    `- Report review readyForUse: ${context.reportReview ? String(context.reportReview.readyForUse) : "unavailable"}`,
    `- Report review readinessScore: ${formatReviewScore(context.reportReview)}`,
    ...recommendations.map((item) => `- Recommendation: ${item}`),
    ...followUpTasks.map((task) => `- Critique follow-up task: ${task.query}`),
    ...nextActions.map((action) => `- Next suggested action: ${action}`),
    ...uncovered.map((item) => `- Uncovered subquestion/context: ${item}`),
    "",
    ...(context.missingArtifacts.length > 0
      ? ["## Missing inputs", "", ...context.missingArtifacts.map((artifact) => `- ${artifact}`), ""]
      : [])
  ].join("\n");
}

async function loadFollowUpContext(runDir: string): Promise<FollowUpContext> {
  const entries = await Promise.all(
    ARTIFACTS.map(async (artifact) => {
      const filePath = path.join(runDir, artifact);
      const text = await readOptionalText(filePath);
      return [artifact, text] as const;
    })
  );
  const texts = new Map(entries);
  const missingArtifacts = entries.filter(([, text]) => text === undefined).map(([artifact]) => artifact);

  return {
    runDir,
    runId: path.basename(runDir),
    runSummary: texts.get("run_summary.md"),
    reportReview: parseOptionalJson<ReportReview>(texts.get("report_review.json")),
    reportReviewMarkdown: texts.get("report_review.md"),
    critique: parseOptionalJson<Critique>(texts.get("critique.json")),
    report: texts.get("report.md"),
    plan: parseOptionalJson<Plan>(texts.get("plan.json")),
    input: texts.get("input.md"),
    missingArtifacts
  };
}

function followUpReason(context: FollowUpContext): string {
  if (context.reportReview?.readyForUse === false) {
    return "Parent report review is not ready for use.";
  }
  if (context.critique?.needsFollowUp) {
    return "Parent critique requested follow-up research.";
  }
  const gaps = topGaps(context);
  if (gaps.length > 0) {
    return `Remaining evidence gap: ${gaps[0]}.`;
  }
  if (context.missingArtifacts.length > 0) {
    return "Generate best-effort follow-up because some parent artifacts are missing.";
  }
  return "Generate targeted follow-up questions from parent research artifacts.";
}

function coveredAreas(context: FollowUpContext): string[] {
  const areas: string[] = [];
  if (context.plan?.topic) {
    areas.push(`Original topic: ${context.plan.topic}`);
  }
  if (context.plan?.objective) {
    areas.push(`Original objective: ${context.plan.objective}`);
  }
  const summaryStatus = findLines(context.runSummary, ["Profile:", "Focus:", "Search provider:", "Researcher mode:"]).slice(0, 4);
  areas.push(...summaryStatus);
  if (context.reportReview?.overallAssessment) {
    areas.push(`Reviewer assessment: ${context.reportReview.overallAssessment}`);
  }
  if (context.reportReview?.sourceQuality.notes) {
    areas.push(`Source quality notes: ${context.reportReview.sourceQuality.notes}`);
  }
  if (areas.length === 0 && context.input) {
    areas.push(`Original input: ${oneLine(context.input).slice(0, 240)}`);
  }
  return areas.length > 0 ? areas : ["Covered areas unavailable from parent artifacts."];
}

function topGaps(context: FollowUpContext): string[] {
  const gaps = [
    ...(context.reportReview?.topGaps ?? []),
    ...(context.reportReview?.gaps.map((gap) => gap.gap) ?? []),
    ...(context.critique?.missingCoverage ?? []),
    ...(context.critique?.weakAreas ?? [])
  ];
  return unique(gaps).slice(0, 6);
}

function topRecommendations(context: FollowUpContext): string[] {
  return unique([...(context.reportReview?.topRecommendations ?? []), ...(context.reportReview?.recommendations ?? [])]).slice(0, 5);
}

function topFollowUpTasks(context: FollowUpContext): SearchTask[] {
  return (context.critique?.followUpTasks ?? []).slice(0, 5);
}

function nextSuggestedActions(runSummary: string | undefined): string[] {
  if (!runSummary) {
    return [];
  }
  const marker = "## Next Suggested Actions";
  const index = runSummary.indexOf(marker);
  if (index === -1) {
    return [];
  }
  const section = runSummary.slice(index + marker.length).split(/\n##\s+/)[0] ?? "";
  return section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter(Boolean)
    .slice(0, 5);
}

function uncoveredSubquestions(context: FollowUpContext): string[] {
  const fromPlan = context.plan?.subquestions.map((item) => item.question) ?? [];
  const explicitLines = findLines(context.report, ["uncovered", "missing", "not covered"]).slice(0, 5);
  return unique([...explicitLines, ...fromPlan]).slice(0, 6);
}

function followUpQuestions(gaps: string[], tasks: SearchTask[], uncovered: string[]): string[] {
  const questions = [
    ...gaps.map((gap) => `What reliable evidence closes this gap: ${gap}?`),
    ...tasks.map((task) => task.query),
    ...uncovered.map((item) => `What additional sources answer: ${item}?`)
  ];
  return unique(questions).slice(0, 8);
}

function findLines(text: string | undefined, needles: string[]): string[] {
  if (!text) {
    return [];
  }
  const loweredNeedles = needles.map((needle) => needle.toLowerCase());
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^- /, ""))
    .filter((line) => loweredNeedles.some((needle) => line.toLowerCase().includes(needle)))
    .map((line) => line.replace(/\s+/g, " "))
    .filter(Boolean);
}

function artifactRef(context: FollowUpContext, artifact: (typeof ARTIFACTS)[number]): string {
  return context.missingArtifacts.includes(artifact) ? `${artifact} missing` : `./${artifact}`;
}

function listOrUnavailable(items: string[]): string[] {
  return items.length > 0 ? items.map((item) => `- ${item}`) : ["- unavailable"];
}

function unique(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items.map(oneLine).filter(Boolean)) {
    const key = item.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

function oneLine(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function formatReviewScore(review: ReportReview | undefined): string {
  if (!review) {
    return "unavailable";
  }
  if (typeof review.readinessScore === "number") {
    return `${review.readinessScore}${review.scoreLabel ? ` / ${review.scoreLabel}` : ""}`;
  }
  return review.qualityScore === undefined ? "unavailable" : `legacy qualityScore ${review.qualityScore}`;
}

function parseOptionalJson<T>(text: string | undefined): T | undefined {
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

async function readOptionalText(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
  }
}

async function assertDirectoryExists(runDir: string): Promise<void> {
  try {
    const runStat = await stat(runDir);
    if (!runStat.isDirectory()) {
      throw new Error(`Run not found: ${runDir}`);
    }
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new Error(`Run not found: ${runDir}`);
    }
    throw error;
  }
  await access(runDir);
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
