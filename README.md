# research-local-xiaomi

`research-local-xiaomi` is a personal local research CLI powered by Xiaomi MiMo chat plus a pluggable search provider. It reads a prompt, creates a run folder, plans the work, searches with OpenCode websearch by default, deduplicates sources, builds evidence, critiques gaps, writes an English Markdown report, reviews it, records usage and debug events, and writes a compact `run_summary.md`.

Version `0.2.1` remains intentionally small: standalone TypeScript, CLI-only, no database, no embeddings, and no browser automation. The usability upgrade adds a human-friendly run summary, a `summary` command, and self-audit documentation without implementing autonomous code modification.

## What It Is Not

- Not a web app or server.
- Not a browser automation system.
- Not a LangChain, LangGraph, MCP, Docker, database, vector store, or embeddings project.
- Not an OpenCode artifact writer. OpenCode is used only as a subprocess search/fetch adapter; `research-xm` writes all run files itself.
- Not a GitHub API client.
- Not an X/Twitter research tool. X/Twitter support is out of scope because access is unreliable and restricted.

## Requirements

- Windows, macOS, or Linux with Node.js 22+.
- `pnpm`.
- Xiaomi MiMo API key for planner, critic, writer, smoke, and experimental Xiaomi native search.
- OpenCode installed and available on `PATH` for the default `opencode-web` search provider.

## Installation

```powershell
pnpm install
pnpm build
pnpm test
pnpm research-xm --help
```

## Environment Variables

Create `.env` from `.env.example` or set variables in PowerShell:

```powershell
$env:XIAOMI_MIMO_API_KEY="..."
$env:XIAOMI_MIMO_BASE_URL="https://token-plan-sgp.xiaomimimo.com/v1"
```

`XIAOMI_MIMO_BASE_URL` is optional. The default is `https://token-plan-sgp.xiaomimimo.com/v1`.

`OPENCODE_MODEL` is optional. If set, the CLI passes it to `opencode run --model`. Correct Xiaomi OpenCode model IDs use the `xiaomi-token-plan-sgp` provider prefix, for example `xiaomi-token-plan-sgp/mimo-v2.5-pro`.

The API key is never written to run artifacts.

## Quick Start

For the first real OpenCode integration test, use the tiny smoke profile and one researcher task:

```powershell
pnpm research-xm run --file .\prompts\interior-design-3d-ai-smoke.md --profile smoke5 --focus web --search-provider opencode-web --max-tasks 1 --opencode-timeout-ms 60000 --researcher-mode extract --notify --verbose
```

Do not use `normal100` for the first integration test; it is intended for longer runs after `smoke5` works.

```powershell
pnpm research-xm run --file .\prompts\example-research.md --profile normal100
```

Medium and deep-ish quality-first runs:

```powershell
pnpm research-xm run --file .\prompts\interior-design-3d-ai-smoke.md --profile normal100 --focus web --search-provider opencode-web --max-tasks 3 --opencode-timeout-ms 120000 --researcher-mode extract --notify --verbose
pnpm research-xm run --file .\prompts\interior-design-3d-ai-smoke.md --profile deep500 --focus web --search-provider opencode-web --max-tasks 12 --opencode-timeout-ms 180000 --researcher-mode extract --notify --verbose
```

Useful example prompts are included:

- `prompts/interior-design-3d-ai-smoke.md`
- `prompts/interior-design-github-smoke.md`
- `prompts/geometry-preserving-followup.md`
- `prompts/research-local-xiaomi-self-audit.md`

The default search provider is `opencode-web`:

```powershell
pnpm research-xm run --file .\prompts\example-research.md --profile normal100 --focus web --search-provider opencode-web
```

Short inline prompts are supported:

```powershell
pnpm research-xm run "Compare open-source deep research tools" --profile normal100
```

Use dry-run mode to verify artifact creation without calling Xiaomi:

```powershell
pnpm research-xm run --file .\prompts\example-research.md --dry-run
```

## Prompt Files

Prompt files are the intended workflow for long 2000-3000 word tasks:

```powershell
pnpm research-xm run --file .\prompts\research-task.md --profile normal100
```

## Profiles

`smoke5` is a tiny integration profile:

- target unique sources: 5
- initial subquestions: 1
- max depth: 1
- max keyword: 1
- result limit: 5
- max concurrent searches: 1
- model: `mimo-v2.5-pro`
- language: English

`normal100` is the default:

- target unique sources: 100
- initial subquestions: 8
- max depth: 2
- max keyword: 3
- result limit: 5
- max concurrent searches: 3
- model: `mimo-v2.5-pro`
- language: English

`deep500`:

- target unique sources: 500
- initial subquestions: 25
- max depth: 3
- max keyword: 4
- result limit: 5
- max concurrent searches: 3
- model: `mimo-v2.5-pro`
- language: English

Target unique sources are targets, not guarantees. The final usage file reports raw annotation count through `evidence.json`, unique source count, and sources used in the report.

## Focus Modes

`web` is the default and searches the broad web.

```powershell
pnpm research-xm run --file .\prompts\research-task.md --focus web
```

`github` asks the planner and OpenCode websearch prompt to focus on repositories, READMEs, docs, examples, issues, source architecture, and implementation patterns.

```powershell
pnpm research-xm run --file .\prompts\research-task.md --focus github
```

The MVP does not clone repositories and does not use the GitHub API.

## Search Providers

`opencode-web` is the default. It spawns `opencode run --format json`, sets `OPENCODE_ENABLE_EXA=1` for the subprocess, and parses OpenCode JSON events from stdout. The provider is built around OpenCode's built-in `websearch` and `webfetch` event shapes; the current source collection prompt uses `websearch` only, extracts sources from completed tool output, deduplicates them, and writes artifacts itself. OpenCode websearch uses Exa through OpenCode; no separate Exa API key is required for this path.

OpenCode must not write `sources.json`, `report.md`, or any other run artifact in this architecture. It returns stdout events only.

`xiaomi-native` remains available as an experimental provider:

```powershell
pnpm research-xm run --file .\prompts\test.md --search-provider xiaomi-native
```

Xiaomi native Web Search may fail for Token Plan keys even when normal Xiaomi chat works. If it fails with `webSearchEnabled is false`, use `--search-provider opencode-web`.

## Researcher Extraction

By default, each search task runs in `--researcher-mode extract`. OpenCode only returns sources; Xiaomi MiMo then receives the task metadata, query, focus, and provider source snippets and extracts grounded structured claims. The finding records `extractionMode: "xiaomi"` when this succeeds.

Use mechanical mode for fast debugging or to preserve the old title/summary claim generation:

```powershell
pnpm research-xm run --file .\prompts\example-research.md --researcher-mode mechanical
```

If extraction returns malformed JSON or fails, the task falls back to mechanical claims, emits fallback events, and the run continues.

## Model Switching

One option changes all roles:

```powershell
pnpm research-xm run --file .\prompts\research-task.md --model mimo-v2.5
pnpm research-xm run --file .\prompts\research-task.md --model mimo-v2.5-pro
```

Internally the config has role model slots so separate planner/researcher/critic/writer models can be added later.

## Commands

```powershell
pnpm dev --help
pnpm research-xm --help
pnpm research-xm run --file .\prompts\my-research.md --profile normal100
pnpm research-xm run --file .\prompts\my-research.md --profile smoke5 --max-tasks 1 --opencode-timeout-ms 60000
pnpm research-xm run --file .\prompts\my-research.md --profile deep500
pnpm research-xm run --file .\prompts\my-research.md --model mimo-v2.5-pro
pnpm research-xm run --file .\prompts\my-research.md --focus github
pnpm research-xm run --file .\prompts\my-research.md --search-provider opencode-web
pnpm research-xm run --file .\prompts\my-research.md --search-provider xiaomi-native
pnpm research-xm run --file .\prompts\my-research.md --researcher-mode extract --notify
pnpm research-xm run --file .\prompts\my-research.md --no-review-report
pnpm research-xm list
pnpm research-xm show latest
pnpm research-xm validate latest
pnpm research-xm summary latest
pnpm research-xm summary latest --path
pnpm research-xm smoke
pnpm research-xm smoke --web
```

`research-xm smoke` uses basic chat only. `research-xm smoke --web` also tests Xiaomi Web Search and prints annotation count and web-search usage when available.

## Output Files

Each run is written under `./runs/<run-id>/`:

- `input.md`
- `config.json`
- `plan.json`
- `queries.json`
- `findings/*.json`
- `sources.json`
- `evidence.json`
- `critique.json`
- `report_review.json`
- `report_review.md`
- `usage.json`
- `events.jsonl`
- `report.md`
- `run_summary.md`

There is no `raw/` directory and no raw provider response archive.

## Reading Run Results

Recommended workflow after a run:

```powershell
pnpm research-xm show latest
pnpm research-xm validate latest
pnpm research-xm summary latest
```

Then open:

- `runs/<run-id>/run_summary.md` for status, quality, usage, source, and next-action overview.
- `runs/<run-id>/report.md` for the research report.
- `runs/<run-id>/report_review.md` for QA gaps and recommendations.

If `run_summary.md` is missing for an older or incomplete run, `research-xm summary latest` generates it from available artifacts when possible and prints a friendly incomplete-run message instead of crashing on missing files.

## Usage And Token Accounting

`usage.json` aggregates:

- total Xiaomi calls and calls by phase
- Xiaomi prompt, completion, and total tokens
- OpenCode calls, websearch calls, webfetch calls, and token totals when present in OpenCode events
- `web_search_usage.tool_usage`
- `web_search_usage.page_usage`
- raw, unique, and report-used source counts
- errors
- start/finish/duration
- profile and model

OpenCode/Exa search cost is not invented. When unavailable, `usage.json` records OpenCode `cost` as `null`.

For early-exit OpenCode runs, token totals may be unavailable because `research-xm` terminates the subprocess after sources are extracted. In that case `usage.json` may include `opencode.tokensUnavailable: true`, and the CLI prints `OpenCode tokens: unavailable (early exit)` instead of presenting `0` as real token accounting.

## Report Review

Report review is enabled by default. After the writer creates `report.md`, Xiaomi MiMo reviews the report against `sources.json`, `evidence.json`, `critique.json`, and the plan. The reviewer does not rewrite the report. It writes:

- `report_review.json`
- `report_review.md`

The CLI summary prints whether review artifacts exist and the reviewer's `readyForUse` value. Disable it with `--no-review-report` when debugging.

## Project And Self-Audit Docs

- `docs/PROJECT_OVERVIEW.md` summarizes the current architecture, providers, pipeline, artifacts, limitations, run sizes, and roadmap for future agents.
- `docs/SELF_AUDIT_WORKFLOW.md` explains how to use research outputs to guide Codex patches safely without letting `research-xm` modify source code.
- `prompts/research-local-xiaomi-self-audit.md` is a reusable prompt fixture for researching how to improve this project.

## Notifications

Add `--notify` to play a best-effort sound when a run succeeds or fails. On Windows this uses PowerShell console beeps; on other platforms it falls back to the terminal bell. Notification failure never fails the research run.

## Citation Format

Reports use numbered citations:

```markdown
This is a factual claim [1].

## Bibliography

[1] Title - https://example.com
```

The citation linter checks that every citation number exists in `sources.json`. If linting fails, the CLI prints a warning and writes an event.

## Security And Privacy

- `.env` is ignored by git.
- `runs/*` is ignored except `runs/.gitkeep`.
- API keys are read from environment variables only.
- `.env` contents are never copied into run artifacts.
- Raw Xiaomi API responses are not stored by default.

## Why Raw Responses Are Not Stored

The tool keeps normalized artifacts that are useful for debugging without archiving complete provider responses. `events.jsonl`, `findings/*.json`, `sources.json`, `evidence.json`, and `usage.json` preserve the important operational and research state while reducing privacy and storage risk.

## Limitations Of v0.2

- CLI-only.
- OpenCode websearch is required for default real search runs.
- Xiaomi native Web Search is experimental.
- English-only final report.
- No raw response storage.
- No embeddings, vector database, or persistent semantic memory.
- No browser automation or Playwright.
- OpenCode does not write artifacts directly.
- No GitHub API.
- No X/Twitter support.
- Source extraction depends on selected provider results being present.
- Citation repair is best effort; lint warnings are not hidden.
- The report reviewer is QA only; it does not revise `report.md`.
- v0.2 does not implement a research-to-backlog knowledge loop.
- v0.2.1 adds run summaries and self-audit docs, but still does not implement autonomous self-modification.

## Why Embeddings Are Not Included Yet

Embeddings may be useful later for searching across previous research runs, local document/PDF/repository RAG, semantic deduplication, source clustering, similarity search across old evidence, and building a persistent knowledge base. They are out of scope for this MVP.

## Why Browser Automation Is Out Of Scope

The MVP relies on Xiaomi Web Search annotations. Browser automation adds fragility, state, credentials, anti-bot handling, rendering issues, and larger dependencies. It can be reconsidered later for specific sites where API/search annotations are insufficient.

## Why OpenCode Does Not Write Artifacts

OpenCode is the default search adapter for real web runs, but it is deliberately limited to stdout JSON events from `websearch`/`webfetch`. It must not edit files, run project commands, or write artifacts. `research-xm` owns all files under each run directory.

## Troubleshooting

- `Missing XIAOMI_MIMO_API_KEY`: set the environment variable or add `.env`.
- `HTTP 401`: check the API key.
- `Malformed JSON`: retry the run; the model may have returned invalid structured output.
- Missing annotations: some Xiaomi responses may not include web annotations. The finding is preserved and source count may be lower.
- First real OpenCode run: use `smoke5 --max-tasks 1 --opencode-timeout-ms 60000`. Use `normal100` only after the smoke path works. `deep500` intentionally makes more calls.
- `pnpm` not found: enable Corepack with `corepack enable`, then run `corepack prepare pnpm@10.12.1 --activate`.

### Xiaomi native Web Search returns webSearchEnabled is false

Normal Xiaomi chat can work while native `web_search` fails. This is likely a Xiaomi plugin, entitlement, or server-side Token Plan issue. It is not fixed by adding `webSearchEnabled: true` to the raw request body. Use `--search-provider opencode-web` for now, or contact Xiaomi support.

### OpenCode model not found

Use the Xiaomi Token Plan provider prefix:

Correct:

```text
xiaomi-token-plan-sgp/mimo-v2.5-pro
```

Wrong:

```text
xiaomi-mimo/mimo-v2.5-pro
```

### OpenCode did not write sources.json

That is expected. OpenCode is not supposed to write files in this architecture. `research-xm` parses OpenCode stdout JSON events and writes `findings/*.json`, `sources.json`, `evidence.json`, `usage.json`, and `report.md` itself.

## Roadmap

- Writer-specific thinking mode configuration.
- Deeper OpenCode webfetch use for source enrichment.
- GitHub API integration.
- Local document, PDF, and repository RAG.
- Embeddings for semantic deduplication, clustering, cross-run search, and persistent knowledge base workflows.
- Stronger citation repair pass.
- Richer source-type ranking.

## GitHub Remote

After the GitHub repository exists and authentication is available:

```powershell
git remote add origin https://github.com/Apartman36/research-local-xiaomi.git
git branch -M main
git push -u origin main
```
