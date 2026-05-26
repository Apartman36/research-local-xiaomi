# Project Overview

`research-local-xiaomi` is a local TypeScript CLI for evidence-grounded research runs. The CLI command is `research-xm`.

It exists to turn a long research prompt into durable local artifacts: plan, search queries, source findings, deduplicated sources, evidence claims, critique, report, report review, usage accounting, event logs, and a compact run summary.

The project is intentionally small: no database, no embeddings, no web UI, no automatic commits, and no autonomous code modification.

## Current Architecture

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

## Providers

- Xiaomi direct API: used for planner, researcher extraction, critic, writer, report reviewer, and smoke tests.
- `opencode-web`: default search provider. It runs OpenCode as a subprocess and parses websearch/webfetch JSON events.
- `xiaomi-native`: experimental native Xiaomi web search path. It can be blocked by the `webSearchEnabled is false` issue for Token Plan keys.

## Pipeline

1. Planner creates research tasks from the input prompt.
2. OpenCode search collects web source candidates for each task.
3. Researcher extractor asks Xiaomi to convert source snippets into grounded claims.
4. TypeScript dedupe/rank normalizes URLs and assigns citation indexes.
5. Critic checks gaps and may request limited follow-up work.
6. Writer creates `report.md`.
7. Report reviewer creates QA-only `report_review.json` and `report_review.md`.
8. Citation linter validates report citation numbers against `sources.json`.
9. Run summary writes `run_summary.md` as the quick navigation and quality overview.

## Run Artifacts

Each run is written under `runs/<run-id>/`:

- `input.md`: original prompt.
- `config.json`: sanitized run configuration.
- `plan.json`: planner output.
- `queries.json`: search tasks.
- `findings/*.json`: per-task research findings.
- `sources.json`: deduplicated sources with citation indexes.
- `evidence.json`: grounded claims mapped to source IDs.
- `critique.json`: critic output.
- `report.md`: final research report.
- `report_review.json`: structured QA review.
- `report_review.md`: human-readable QA review.
- `usage.json`: call, token, source, error, and duration accounting.
- `events.jsonl`: operational event log.
- `run_summary.md`: compact status, output, quality, usage, review, source, and next-action summary.

## Known Limitations

- OpenCode token accounting can be unavailable because the provider exits early after source extraction.
- `deep500` still needs a chunked writer for very large source sets.
- The report reviewer is QA-only and does not rewrite `report.md`.
- `xiaomi-native` web search is blocked in some environments by `webSearchEnabled is false`.
- The project has no persistent cross-run knowledge base yet.

## Recommended Run Sizes

- Smoke: `--profile smoke5 --max-tasks 1 --opencode-timeout-ms 60000`.
- Medium: `--profile normal100 --max-tasks 3 --opencode-timeout-ms 120000`.
- Deep-ish: `--profile deep500 --max-tasks 12 --opencode-timeout-ms 180000`.

Use smoke runs to verify provider wiring before spending tokens on larger runs.

## Roadmap

- v0.2.1: run summaries, summary command, project overview docs, self-audit workflow docs, and self-audit prompt fixture.
- v0.3: research-driven development loop where research insights become reviewed implementation recommendations for Codex patches.
- Future direct search providers that avoid depending on OpenCode for web search.
- Future chunked writer for large source sets and deep profiles.
