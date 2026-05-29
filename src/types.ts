export type ResearchFocus = "web" | "github";
export type ResearchProfileName = "smoke5" | "normal100" | "deep500";
export type Confidence = "low" | "medium" | "high";
export type Phase = "promptNormalizer" | "planner" | "researcher" | "critic" | "writer" | "reportReviewer" | "smoke";
export type SearchProviderName = "opencode-web" | "xiaomi-native";
export type ResearcherMode = "extract" | "mechanical";
export type QuotaMode = "conservative" | "normal" | "aggressive";
export type ReadinessScore = -2 | -1 | 0 | 1 | 2;
export type ScoreLabel = "harmful" | "weak" | "mixed" | "useful" | "strong";
export type RunStage =
  | "planner"
  | "search"
  | "researcher"
  | "critic"
  | "writer"
  | "reportReviewer"
  | "citationLint"
  | "summary"
  | "completed";

export type ResearchProfile = {
  name: ResearchProfileName;
  targetUniqueSources: number;
  initialSubquestions: number;
  maxDepth: number;
  maxKeyword: number;
  limit: number;
  maxConcurrentSearches: number;
  model: string;
  language: "en";
};

export type RoleModels = {
  promptNormalizer: string;
  planner: string;
  researcher: string;
  critic: string;
  writer: string;
  reportReviewer: string;
};

export type RoleTokenLimits = {
  promptNormalizer: number;
  planner: number;
  researcher: number;
  critic: number;
  writer: number;
  reportReviewer: number;
};

export type RunConfig = {
  runId: string;
  prompt: string;
  profile: ResearchProfile;
  focus: ResearchFocus;
  searchProvider: SearchProviderName;
  outputDirRoot: string;
  runDir: string;
  apiBaseUrl: string;
  model: string;
  opencodeModel: string;
  opencodeTimeoutMs: number;
  opencodeRetries: number;
  xiaomiTimeoutMs: number;
  writerTimeoutMs?: number;
  roleModels: RoleModels;
  maxOutputTokens: RoleTokenLimits;
  concurrency: number;
  maxTasks?: number;
  quotaMode: QuotaMode;
  promptNormalize: boolean;
  researcherMode: ResearcherMode;
  reviewReport: boolean;
  notify: boolean;
  dryRun: boolean;
  verbose: boolean;
  startedAt: string;
  parentRunId?: string;
  followUpDepth?: number;
  followUpReason?: string;
  gapsAddressed?: string[];
  followUpPromptPath?: string;
  isFollowUpRun?: boolean;
};

export type NormalizedResearchRequest = {
  schemaVersion: 1;
  researchTopic: string;
  researchObjective: string;
  userContext: string;
  constraints: string[];
  mustCover: string[];
  outputRequirements: string[];
  negativeRequirements: string[];
  detectedPromptSections: string[];
  confidence: Confidence;
  warnings: string[];
  rawInputSha256: string;
};

export type RunState = {
  config: RunConfig;
  plan?: Plan;
  tasks: SearchTask[];
  findings: Finding[];
  sources: Source[];
  evidence?: EvidenceFile;
  critique?: Critique;
  report?: string;
};

export type Subquestion = {
  id: string;
  question: string;
  rationale?: string;
};

export type SearchTask = {
  id: string;
  subquestionId: string;
  query: string;
  rationale?: string;
  depth: number;
  focus: ResearchFocus;
};

export type Plan = {
  topic: string;
  objective: string;
  assumptions: string[];
  subquestions: Subquestion[];
  searchTasks: SearchTask[];
};

export type NormalizedAnnotation = {
  url: string;
  canonicalUrl: string;
  title?: string;
  summary?: string;
  siteName?: string;
  publishTime?: string;
};

export type Finding = {
  taskId: string;
  subquestionId: string;
  query: string;
  assistantSynthesis: string;
  annotations: NormalizedAnnotation[];
  claims: EvidenceClaim[];
  extractionMode?: "xiaomi" | "fallback" | "mechanical";
  warnings?: string[];
  parseFailed?: boolean;
  parseError?: string;
  extractionError?: string;
  unmatchedSourceRefs?: string[];
  usage?: XiaomiUsage;
  error?: string;
};

export type Source = {
  id: string;
  citationIndex: number;
  url: string;
  canonicalUrl: string;
  title?: string;
  summary?: string;
  siteName?: string;
  publishTime?: string;
  firstSeenInTaskId: string;
  seenCount: number;
  focus?: ResearchFocus;
};

export type EvidenceClaim = {
  id: string;
  subquestionId: string;
  taskId: string;
  text: string;
  sourceIds: string[];
  confidence: Confidence;
};

export type EvidenceFile = {
  generatedAt: string;
  claims: EvidenceClaim[];
  sourceCount: number;
  rawAnnotationCount: number;
};

export type Critique = {
  summary: string;
  weakAreas: string[];
  missingCoverage: string[];
  duplicateEvidence: string[];
  followUpTasks: SearchTask[];
  needsFollowUp: boolean;
};

export type ReportReview = {
  overallAssessment: string;
  readinessScore?: ReadinessScore;
  scoreLabel?: ScoreLabel;
  qualityScore?: number;
  validationWarning?: string;
  invalidReadinessScore?: unknown;
  topGaps?: string[];
  topRecommendations?: string[];
  sourceQualityNotes?: string[];
  followUpQueries?: string[];
  parseFallback?: boolean;
  rawOutputPath?: string;
  citationAssessment: {
    hasUnsupportedClaims: boolean;
    unsupportedClaims: Array<{
      claim: string;
      reason: string;
      suggestedFix?: string;
    }>;
    citationCoverage: string;
  };
  sourceQuality: {
    strongSources: string[];
    weakSources: string[];
    marketingHeavy: boolean;
    notes: string;
  };
  gaps: Array<{
    gap: string;
    whyItMatters: string;
    suggestedFollowUpQuery?: string;
  }>;
  recommendations: string[];
  readyForUse: boolean;
};

export type XiaomiUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  web_search_usage?: {
    tool_usage?: number;
    page_usage?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type TokenAccounting = {
  schemaVersion: 1;
  directXiaomi: {
    known: boolean;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    calls: number;
  };
  openCode: {
    known: boolean;
    tokens: number | null;
    calls: number;
    attempts: number;
    successfulCalls: number;
    reason: "early_exit" | "not_reported" | "not_applicable" | "reported";
    estimatedTokens: number;
    estimateMethod: "none" | "calls_multiplier" | "events_heuristic";
  };
  total: {
    known: boolean;
    knownDirectTokens: number;
    estimatedTotalTokens: number;
    isLowerBound: boolean;
    tokenAccountingCompleteness: "complete" | "direct-only" | "estimated" | "unavailable";
  };
  quotaRiskLevel: "green" | "amber" | "red";
  warnings: string[];
};

export type UsageSummary = {
  totalCalls: number;
  promptNormalizerCalls?: number;
  callsByPhase: Record<string, number>;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  web_search_usage: {
    tool_usage: number;
    page_usage: number;
  };
  uniqueSources: number;
  sourcesUsedInReport: number;
  errors: number;
  started_at: string;
  finished_at?: string;
  duration_seconds?: number;
  profile: ResearchProfileName;
  model: string;
  quotaMode?: QuotaMode;
  xiaomi: {
    calls: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  opencode: {
    calls: number;
    attempts: number;
    websearch_calls: number;
    webfetch_calls: number;
    retries: number;
    failures: number;
    last_error?: string;
    tokens: {
      total: number;
      input: number;
      output: number;
      reasoning: number;
      cache_read: number;
      cache_write: number;
    };
    tokensUnavailable?: boolean;
    cost: null;
  };
  sources: {
    raw_sources: number;
    unique_sources: number;
    used_in_report: number;
  };
  tokenAccounting?: TokenAccounting;
};

export type XiaomiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  annotations?: unknown[];
};

export type XiaomiResponse = {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: XiaomiMessage;
    finish_reason?: string;
  }>;
  usage?: XiaomiUsage;
  error?: unknown;
};

export type CitationLintResult = {
  ok: boolean;
  citedNumbers: number[];
  unknownNumbers: number[];
  sourcesUsed: number;
};

export type RunStateStatus = "running" | "completed" | "failed" | "partial";

export type RunStateFile = {
  schemaVersion: 1;
  runId: string;
  status: RunStateStatus;
  currentStage: RunStage;
  completedStages: RunStage[];
  failedStage: RunStage | null;
  lastError: string | null;
  updatedAt: string;
  canResume: boolean;
  artifacts: Record<string, string>;
};
