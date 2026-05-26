export type ResearchFocus = "web" | "github";
export type ResearchProfileName = "smoke5" | "normal100" | "deep500";
export type Confidence = "low" | "medium" | "high";
export type Phase = "planner" | "researcher" | "critic" | "writer" | "reportReviewer" | "smoke";
export type SearchProviderName = "opencode-web" | "xiaomi-native";
export type ResearcherMode = "extract" | "mechanical";

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
  planner: string;
  researcher: string;
  critic: string;
  writer: string;
  reportReviewer: string;
};

export type RoleTokenLimits = {
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
  roleModels: RoleModels;
  maxOutputTokens: RoleTokenLimits;
  concurrency: number;
  maxTasks?: number;
  researcherMode: ResearcherMode;
  reviewReport: boolean;
  notify: boolean;
  dryRun: boolean;
  verbose: boolean;
  startedAt: string;
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
  qualityScore: number;
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

export type UsageSummary = {
  totalCalls: number;
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
  xiaomi: {
    calls: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  opencode: {
    calls: number;
    websearch_calls: number;
    webfetch_calls: number;
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
