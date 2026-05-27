# Research Task: Open-Source Agentic Research and Self-Improving Development Systems

## Role

You are a senior AI systems researcher, open-source software analyst, TypeScript/Node.js architect, and AI coding workflow strategist.

You are researching open-source projects and public technical patterns that are relevant to building a local research orchestration CLI called `research-local-xiaomi`.

The goal is not just to summarize projects. The goal is to understand how successful open-source agentic research, deep-research, and self-improving development systems work internally, what features they provide, how they are operated, and what design ideas should be adapted into `research-local-xiaomi`.

## Context: Our Project

We are building a local TypeScript/Node.js CLI project:

Project name:
`research-local-xiaomi`

CLI:
`research-xm`

Repository:
`https://github.com/Apartman36/research-local-xiaomi`

Current architecture:

Planner Xiaomi
  ↓
Searcher/OpenCode
  ↓
Researcher Extractor Xiaomi per task
  ↓
Deduper/Ranker TypeScript
  ↓
Critic Xiaomi
  ↓
Writer Xiaomi
  ↓
Report Reviewer Xiaomi
  ↓
Citation Linter TypeScript
  ↓
Run Summary Markdown

Current capabilities:

- Runs local research workflows from Markdown prompts.
- Uses Xiaomi MiMo for planner, researcher extractor, critic, writer, and report reviewer.
- Uses OpenCode as a web search adapter through `opencode-web`.
- Extracts sources and evidence into local run artifacts.
- Writes reports with citations.
- Writes `report_review.json`, `report_review.md`, and `run_summary.md`.
- Supports `--opencode-retries` for unstable network conditions.
- Supports Codex-driven decision-point research workflow.
- Stores run artifacts locally under `runs/<runId>/`.

Important philosophy:

- The system should not autonomously modify its own code.
- Codex is the implementation agent.
- `research-xm` is a research oracle.
- Claude Code can be used as read-only reviewer/tester.
- Human remains in control.
- Git is the memory of code versions.
- Research should produce actionable insight, but implementation should be done through controlled patches.

Current limitations:

- No automatic follow-up loop yet.
- No `research-xm follow-up latest` command yet.
- No project-context command yet.
- No chunked writer for very large source sets yet.
- No automated knowledge append yet.
- No direct Exa/Tavily/Brave provider yet.
- OpenCode token accounting is usually unavailable due to early exit.
- Reports sometimes become too summarized; we want richer, more detailed, code-useful outputs.
- Reviewer often identifies gaps, but the system does not yet automatically turn gaps into follow-up research runs.

## What We Want To Learn

Research open-source and public projects that are similar or adjacent to our goals:

### Deep research / research agents

Examples to investigate:

- GPT Researcher
  - GitHub: assafelovic/gpt-researcher
  - Website: gptr.dev

- LangChain Open Deep Research
  - GitHub: langchain-ai/open_deep_research

- LearningCircuit local-deep-research
  - GitHub: LearningCircuit/local-deep-research

- Other open-source deep research agents, local research assistants, or report-writing agents.

### Self-improving / learning agents

Examples to investigate:

- Nous Research Hermes Agent
  - Website: nousresearch.com
  - Website/docs: hermes-agent.nousresearch.com
  - GitHub: NousResearch/hermes-agent

- BerriAI self-improving-agent
  - GitHub: BerriAI/self-improving-agent

- OpenAI cookbook / examples related to agent improvement loops.

- Other projects that implement:
  - skill creation
  - memory persistence
  - self-improvement loops
  - human-approved diffs
  - evaluation-driven prompt improvement
  - recursive agent improvement

### AI coding agent orchestration / development loops

Examples to investigate:

- OpenCode
- Claude Code
- Codex / OpenAI coding workflows
- GitHub Copilot agents
- agent improvement loop notebooks
- codebase audit agents
- systems that combine research + implementation + review

### Related patterns

Investigate patterns such as:

- planner → researcher → writer → reviewer
- map-reduce report writing
- source quality ranking
- evidence extraction
- citation validation
- gap detection
- follow-up research generation
- agent memory
- skill files
- knowledge logs
- human-in-the-loop patch approval
- project context snapshots
- local-first run stores
- CLI-first developer workflows
- prompt improvement loops
- eval-driven agent improvement

## Core Research Questions

### 1. Project Landscape

What open-source projects are most relevant to `research-local-xiaomi`?

For each important project, identify:

- Name
- URL / GitHub repository
- License, if available
- Primary language
- Main architecture
- Main features
- How to run it
- What artifacts it produces
- Whether it supports CLI, API, web UI, Docker, or local-only operation
- Whether it supports multiple model providers
- Whether it supports multiple search providers
- Whether it supports citations
- Whether it supports memory / knowledge persistence
- Whether it supports self-improvement or agent skill creation
- Whether it edits code or only produces recommendations
- Whether it has human approval gates

### 2. Architecture Comparison

Compare these systems against our current architecture:

Current architecture:
Planner Xiaomi → OpenCode Search → Xiaomi Researcher Extractor → Deduper/Ranker → Xiaomi Critic → Xiaomi Writer → Xiaomi Report Reviewer → Citation Linter → Run Summary

For each relevant project, answer:

- Does it have a planner?
- Does it have dedicated researcher agents?
- Does it have a writer/synthesizer?
- Does it have a critic/reviewer?
- Does it have follow-up research loops?
- Does it preserve evidence and sources?
- Does it support source quality ranking?
- Does it validate citations?
- Does it produce machine-readable artifacts?
- Does it produce human-readable summaries?
- Does it support retries/resume?
- Does it support long-form reports?
- Does it support local/offline documents?
- Does it support codebase-aware research?

### 3. Feature Mining

Identify features that `research-local-xiaomi` should consider adopting.

Group them by priority:

#### Must-have next
Features that should be implemented soon.

#### Useful later
Features that are valuable but not urgent.

#### Avoid for now
Features that look attractive but would make the project too complex.

Possible examples:

- `research-xm follow-up latest`
- `research-xm project-context`
- `research-xm dev-research`
- chunked writer
- section-by-section writer
- source quality score
- primary/secondary/source-type classification
- automatic reviewer-gap follow-up prompt generation
- knowledge/research-log.md append
- implementation_backlog.json
- codex_patch_plan.md
- report length/detail controls
- prompt improvement suggestions
- report reviewer suggested prompt changes
- project-specific skill files
- source freshness scoring
- result comparison across multiple LLMs
- resume from failed writer stage
- role-specific Xiaomi timeout/retry
- direct search providers
- GitHub issues search
- Reddit/community search
- benchmark collection mode
- long-form appendix mode

### 4. Commands and UX

Investigate command-line UX in similar projects.

What commands do they expose?

Examples to look for:

- run
- research
- deep-research
- resume
- follow-up
- evaluate
- benchmark
- export
- serve
- init
- configure
- list
- show
- validate
- summarize
- open
- replay
- inspect
- compare

For each useful command idea, explain:

- What it does
- Whether it fits our project
- What artifacts it reads/writes
- Whether it should be in v0.4, v0.5, or later

### 5. Prompting and Agent Design

Analyze whether our current quality bottleneck is likely caused by:

- prompts
- agent roles
- too few sources
- source quality
- search queries
- writer compression
- lack of follow-up loops
- lack of primary source targeting
- lack of report length/detail controls
- lack of appendices
- lack of task-specific output schemas
- lack of evaluator-driven prompt refinement

Investigate how similar systems prompt their planner/researcher/writer/reviewer, if public.

Recommend improvements to our prompts:

- Planner prompt
- Researcher extractor prompt
- Critic prompt
- Writer prompt
- Report reviewer prompt

Especially answer:

- Should one agent suggest prompt improvements for another?
- Should the reviewer output `prompt_improvements`?
- Should the critic output follow-up queries and source-quality requirements?
- Should the writer have a “long-form / detailed” mode?
- Should reports include appendices so useful details are not summarized away?

### 6. Follow-Up Loop Design

Design a practical `research-xm follow-up latest` command.

It should:

1. Read `critique.json`, `report_review.json`, `run_summary.md`, and optionally `report.md`.
2. Extract unresolved gaps and follow-up queries.
3. Generate a new follow-up prompt.
4. Start a new research run or write the prompt for human review.
5. Link the new run to the parent run.
6. Preserve lineage:
   - parentRunId
   - followUpReason
   - inheritedTopic
   - gapsAddressed
7. Produce a combined summary after follow-up runs.

Questions to answer:

- Should `follow-up latest` run immediately or create a prompt first?
- Should it support `--execute` vs `--write-prompt-only`?
- Should it merge reports?
- Should it append to knowledge/research-log.md?
- How should it avoid endless follow-up loops?
- How many follow-up tasks should it run by default?
- How should it decide which gaps are highest priority?

### 7. Research-Driven Development Loop

Design a safe Codex-driven development loop:

Codex writes code.
At decision points, Codex runs research.
Codex reads `run_summary.md`, `report_review.md`, and `report.md`.
Codex uses the result to make a patch plan.
Codex implements.
Tests run.
Human reviews.
Commit.

Questions:

- Should research run at the beginning of every non-trivial Codex task?
- What counts as a “non-trivial” task?
- How should Codex decide whether research is needed?
- How should it avoid wasting time?
- What should be written into `.codex/skills/use-research-xm.md`?
- What should be written into `knowledge/research-log.md`?
- How should commits reference research runs?
- Should the project have `docs/COMMANDS_REFERENCE.md` and `docs/CODEX_RESEARCH_WORKFLOW.md`?

### 8. Output Depth and Report Length

We want reports to be useful for Codex and Claude Code as input.

They do not mind reading 5,000–20,000 tokens if the information is clear and actionable.

We do not want the writer to compress away important details.

Investigate best practices for deep research output structure.

Recommend whether reports should include:

- Executive summary
- Decision matrix
- Detailed sections
- Evidence table
- Source quality table
- Claims table
- Open questions
- Follow-up queries
- Implementation implications
- Prompt improvement suggestions
- Appendices
- Full source notes
- Per-task mini-summaries
- “For Codex implementation” section

Suggest a report structure for `research-local-xiaomi` that balances depth and clarity.

### 9. Failure Handling and Resume

Our recent self-audit run failed at writer stage:

- OpenCode collected 40 sources.
- Researcher extraction completed.
- Critic completed.
- Writer started.
- Xiaomi API request timed out after 120000 ms.
- Run became incomplete.

Investigate how similar systems handle:

- long writer timeouts
- retrying writer calls
- resume from failed stage
- chunked writing
- partial reports
- preserving expensive search/extraction work
- role-specific timeouts
- role-specific retries

Recommend how we should handle this in v0.4/v0.5.

## Output Requirements

Produce a detailed, practical report in English.

Do not produce a short two-page summary.

The intended reader is a developer and AI coding agent. They can handle detail.

Use this structure:

# Executive Summary

# Project Landscape

# Comparison Table

# Architecture Patterns Worth Copying

# Features To Adopt

## Must-Have Next

## Useful Later

## Avoid For Now

# Command and UX Ideas

# Prompt and Agent Design Recommendations

# Follow-Up Loop Design

# Research-Driven Development Workflow

# Report Depth and Writer Recommendations

# Failure Handling and Resume Recommendations

# Recommended v0.4 Roadmap

# Recommended v0.5+ Roadmap

# Concrete Implementation Backlog

# Risks and Tradeoffs

# Open Questions

# Sources

## Important Rules

- Prefer official docs and GitHub repositories.
- Include GitHub examples.
- Include commands/install snippets where useful.
- Mark uncertain claims clearly.
- Distinguish primary sources from secondary commentary.
- Do not overclaim.
- Do not recommend autonomous self-modification.
- Keep human approval gates.
- Focus on practical implementation value for `research-local-xiaomi`.
- If a project looks useful, explain exactly what feature we should copy and how.
- If a project looks too complex, explain what not to copy.
- Report language: English.