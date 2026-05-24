# research-local-xiaomi

`research-local-xiaomi` is a personal local research CLI powered by Xiaomi MiMo Web Search. It reads a prompt, creates a run folder, plans the work, searches with Xiaomi, deduplicates sources, builds evidence, critiques gaps, writes an English Markdown report, and records usage and debug events.

Version `0.1.0` is intentionally small: standalone TypeScript, Xiaomi-only, CLI-only.

## What It Is Not

- Not a web app or server.
- Not a browser automation system.
- Not a LangChain, LangGraph, MCP, Docker, database, vector store, or embeddings project.
- Not an OpenCode orchestrator. OpenCode examples are included only as future optional sketches.
- Not a GitHub API client.
- Not an X/Twitter research tool. X/Twitter support is out of scope because access is unreliable and restricted.

## Requirements

- Windows, macOS, or Linux with Node.js 22+.
- `pnpm`.
- Xiaomi MiMo API key for real runs.

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

The API key is never written to run artifacts.

## Quick Start

```powershell
pnpm research-xm run --file .\prompts\example-research.md --profile normal100
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

`github` asks the planner to focus on repositories, READMEs, docs, examples, issues, source architecture, and implementation patterns. It still uses Xiaomi Web Search only and may generate `site:github.com` queries.

```powershell
pnpm research-xm run --file .\prompts\research-task.md --focus github
```

The MVP does not clone repositories and does not use the GitHub API.

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
pnpm research-xm run --file .\prompts\my-research.md --profile deep500
pnpm research-xm run --file .\prompts\my-research.md --model mimo-v2.5-pro
pnpm research-xm run --file .\prompts\my-research.md --focus github
pnpm research-xm list
pnpm research-xm show latest
pnpm research-xm validate latest
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
- `usage.json`
- `events.jsonl`
- `report.md`

There is no `raw/` directory and no raw provider response archive.

## Usage And Token Accounting

`usage.json` aggregates:

- total calls
- calls by phase
- prompt tokens
- completion tokens
- total tokens
- `web_search_usage.tool_usage`
- `web_search_usage.page_usage`
- unique sources
- sources used in report
- errors
- start/finish/duration
- profile and model

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

## Limitations Of v0.1

- CLI-only.
- Xiaomi-only.
- English-only final report.
- No raw response storage.
- No embeddings, vector database, or persistent semantic memory.
- No browser automation or Playwright.
- No OpenCode dependency.
- No GitHub API.
- No X/Twitter support.
- Source extraction depends on Xiaomi annotations being present.
- Citation repair is best effort; lint warnings are not hidden.

## Why Embeddings Are Not Included Yet

Embeddings may be useful later for searching across previous research runs, local document/PDF/repository RAG, semantic deduplication, source clustering, similarity search across old evidence, and building a persistent knowledge base. They are out of scope for this MVP.

## Why Browser Automation Is Out Of Scope

The MVP relies on Xiaomi Web Search annotations. Browser automation adds fragility, state, credentials, anti-bot handling, rendering issues, and larger dependencies. It can be reconsidered later for specific sites where API/search annotations are insufficient.

## Why OpenCode Is Optional/Future

OpenCode is useful for future repository analysis or independent review workflows, but the MVP must run as a standalone TypeScript CLI. The `.opencode` files are examples only; the main pipeline does not call `opencode`.

## Troubleshooting

- `Missing XIAOMI_MIMO_API_KEY`: set the environment variable or add `.env`.
- `HTTP 401`: check the API key.
- `Malformed JSON`: retry the run; the model may have returned invalid structured output.
- Missing annotations: some Xiaomi responses may not include web annotations. The finding is preserved and source count may be lower.
- Long runs: use `normal100` first. `deep500` intentionally makes more calls.
- `pnpm` not found: enable Corepack with `corepack enable`, then run `corepack prepare pnpm@10.12.1 --activate`.

## Roadmap

- Writer-specific thinking mode configuration.
- OpenCode worker integration for cloned repository architecture analysis.
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
