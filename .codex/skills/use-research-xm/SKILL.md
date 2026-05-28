---
name: use-research-xm
description: Use this skill whenever Codex is working on a non-trivial implementation decision in the research-local-xiaomi repository, especially when external research, similar GitHub projects, current documentation, best practices, API behavior, or prior research artifacts may affect the patch.
---

# Use research-xm for decision-point development research

## When to use this skill

Use this skill when:

- starting a non-trivial feature or architecture patch
- comparing implementation strategies
- deciding whether to copy patterns from open-source projects
- working with unfamiliar external APIs/libraries/tools
- repeated test failures suggest missing context
- report_review or critique says current evidence is incomplete
- user asks for research-driven implementation
- working on v0.4/v0.5 roadmap features

Do not use this skill for:

- typo fixes
- simple TypeScript errors
- formatting only
- tiny unit test additions
- edits fully explained by local code

## Tool choice

Use:

- research-xm for broad research, open-source landscape, implementation strategy, project comparisons, follow-up questions, and evidence-backed recommendations.
- Context7 MCP for fresh library/API documentation and code examples.
- local repo inspection for facts about this codebase.

Codex must be opened from the repository root to see this repo-local skill:

```text
C:\Users\hustlePC\PycharmProjects\research-local-xiaomi
```

If `.codex/skills/use-research-xm/SKILL.md` or `docs/COMMANDS_REFERENCE.md` is missing, Codex is likely in the wrong workspace.

Treat `input/` as ignored scratch for one-off local prompts. Keep reusable prompt fixtures in committed `prompts/`.

Do not confuse these:

- Context7 gives current docs for libraries.
- research-xm produces research reports with sources, critique, review, summary, and artifacts.
- local code is the source of truth for current implementation.

## Standard research command

Use PowerShell:

```powershell
corepack pnpm research-xm run `
  --file .\input\<topic>.md `
  --profile normal100 `
  --focus github `
  --search-provider opencode-web `
  --max-tasks 5 `
  --opencode-timeout-ms 180000 `
  --opencode-retries 2 `
  --xiaomi-timeout-ms 120000 `
  --writer-timeout-ms 300000 `
  --concurrency 1 `
  --researcher-mode extract `
  --review-report `
  --notify `
  --verbose

[console]::beep(880,700)
```

## Quick smoke command

```powershell
corepack pnpm research-xm run `
  --file .\prompts\interior-design-3d-ai-smoke.md `
  --profile smoke5 `
  --focus web `
  --search-provider opencode-web `
  --max-tasks 1 `
  --opencode-timeout-ms 60000 `
  --opencode-retries 2 `
  --xiaomi-timeout-ms 120000 `
  --concurrency 1 `
  --researcher-mode extract `
  --review-report `
  --notify `
  --verbose

[console]::beep(880,700)
```

## After research completes

Read in this order:

1. run_summary.md
2. report_review.md
3. report.md
4. critique.json
5. sources.json / evidence.json only if deeper diagnosis is needed
6. events.jsonl / usage.json only if debugging

Reviewer readiness uses `readinessScore`: -2 harmful, -1 weak, 0 mixed, 1 useful, 2 strong. Invalid values are normalized conservatively to -1 / weak and preserve diagnostics. If parsing falls back, inspect `report_review_raw.txt`.

## Follow-up commands

Safe prompt-only mode:

```powershell
corepack pnpm research-xm follow-up latest --write-prompt-only

[console]::beep(880,700)
```

Explicit child execution mode:

```powershell
corepack pnpm research-xm follow-up latest `
  --execute `
  --profile normal100 `
  --focus github `
  --search-provider opencode-web `
  --max-tasks 5 `
  --opencode-timeout-ms 180000 `
  --opencode-retries 2 `
  --xiaomi-timeout-ms 120000 `
  --writer-timeout-ms 300000 `
  --concurrency 1 `
  --researcher-mode extract `
  --review-report `
  --notify `
  --verbose

[console]::beep(880,700)
```

Exactly one of `--write-prompt-only` or `--execute` is required. Child `config.json` records `parentRunId`, `isFollowUpRun`, `followUpDepth`, `followUpReason`, `gapsAddressed`, and `followUpPromptPath`. Execution is limited to depth 1; if `latest` is already a child, use the suggested command with `parentRunId`. Prompt-only mode is allowed on child runs.

## Resume commands

Resume late-stage failures without rerunning completed search/extraction work:

```powershell
corepack pnpm research-xm resume latest `
  --writer-timeout-ms 300000 `
  --notify `
  --verbose

[console]::beep(880,700)
```

Resume reads `state.json`, operates in the same run directory, appends resume events to `events.jsonl`, and supports `writer`, `reportReviewer`, `citationLint`, and `summary` failures when required artifacts exist. It does not resume incomplete OpenCode search/extraction work yet.

## How to use findings

- Convert findings into a small patch plan.
- Prefer direct implementation over overengineering.
- Do not blindly apply recommendations.
- Keep human approval gates.
- Do not let research-xm edit source code.
- Do not auto-update prompts from reviewer suggestions; write suggestions as artifacts/docs only.

## Final response requirements

If you used this skill, Context7, or any MCP/plugin, mention:

- name
- why it was used
- what it changed or verified

Before completion:

- run build
- run typecheck
- run tests
- run relevant CLI help or smoke commands
- include exact command outputs in the final report

## Git requirements

Before editing:

- inspect status/log/branch
- work on a feature branch for non-trivial patches

After successful verification:

- stage only intended files
- commit
- push branch
- report commit hash and branch name

Do not stage:

- .env
- runs/
- zip files
- .idea/
- local scratch artifacts
