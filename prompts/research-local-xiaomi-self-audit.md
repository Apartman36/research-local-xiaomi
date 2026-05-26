# Self-Audit Research Prompt: research-local-xiaomi

You are researching how to improve `research-local-xiaomi`, a local TypeScript/Node.js CLI for evidence-grounded research runs.

Use `docs/PROJECT_OVERVIEW.md` as local project context before running this prompt. Do not assume the full codebase is included. Focus on external research and practical architectural recommendations.

## Project Context

`research-local-xiaomi` currently implements this pipeline:

```text
Planner Xiaomi
  -> Searcher/OpenCode
  -> Researcher Extractor Xiaomi per task
  -> Deduper/Ranker TypeScript
  -> Critic Xiaomi
  -> Writer Xiaomi
  -> Report Reviewer Xiaomi
  -> Citation Linter TypeScript
  -> Run Summary TypeScript
```

It is intentionally CLI-only with no database, no embeddings, no web UI, and no automatic code modification. Current artifacts include `report.md`, `report_review.md`, `sources.json`, `evidence.json`, `usage.json`, `events.jsonl`, and `run_summary.md`.

## Research Goal

Investigate how `research-local-xiaomi` should evolve from v0.2.1 toward a safer v0.3 research-driven development workflow:

```text
research -> insights -> recommendations -> Codex patch -> tests -> commit -> next version
```

The research system should help produce insights and recommendations, but should not automatically modify source code.

## External Systems To Compare

Research similar open-source or public systems, including:

- GPT Researcher
- local-deep-researcher
- Open Deep Research
- JigsawStack deep research
- agentic research CLIs
- codebase audit agents
- AI coding agent orchestration systems

Prioritize primary docs, repositories, architecture notes, implementation guides, and credible technical writeups.

## Best Practices To Investigate

Assess patterns for:

- planner/researcher/writer/critic architectures;
- evidence extraction and claim grounding;
- source ranking and source quality scoring;
- citation validation and citation repair;
- report reviewing and QA gates;
- map-reduce or chunked writing for large source sets;
- self-improvement loops;
- research-to-backlog workflows;
- keeping research recommendations separate from code modification;
- testing strategies for CLI research systems.

## Improvement Areas For research-local-xiaomi

Evaluate what should improve in:

- researcher extraction quality;
- report review;
- writer chunking;
- source quality ranking;
- planner robustness;
- run summaries;
- knowledge accumulation;
- direct search providers;
- testing strategy.

## Required Output

Produce an evidence-grounded report with:

1. Comparison with similar systems.
2. Architectural recommendations for v0.3.
3. Prioritized backlog with effort/risk notes.
4. Risks and failure modes.
5. Suggested v0.3 roadmap.
6. Which ideas should explicitly remain out of scope.
7. Sources with citations.

Prefer concrete recommendations that can be converted into a scoped Codex patch prompt.
