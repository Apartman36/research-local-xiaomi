# Codex Research Workflow

This project uses `research-xm` as an external research oracle for Codex-driven development. Codex remains the developer, Git remains the version memory, and the human user remains in control of scope and commits.

Core principle: run `research-xm` at decision points, not on a timer.

The canonical Codex Agent Skill for this workflow is `.codex/skills/use-research-xm/SKILL.md`.
Use `docs/COMMANDS_REFERENCE.md` for quick command syntax.

## When Codex Should Run Research

Codex should consider running `research-xm` when:

1. Making an architectural decision.
2. Comparing libraries, tools, frameworks, providers, or patterns.
3. Seeing repeated test failures or repeated patch failures.
4. Working with an unfamiliar API, SDK, CLI, protocol, or third-party service.
5. Evaluating similar open-source projects.
6. Deciding between multiple implementation strategies.
7. Preparing a v0.x roadmap or major refactor.
8. Needing current external information.
9. Investigating quality, security, or reliability best practices.
10. `report_review.md` says the current evidence is incomplete.

Codex should not run `research-xm`:

1. For trivial local-only edits.
2. For simple TypeScript syntax fixes.
3. When all required information is already in the repo.
4. In a tight edit-test loop where no external information is needed.
5. Automatically every N minutes.

## Recommended Loop

1. Read `docs/PROJECT_OVERVIEW.md`.
2. Read the current task.
3. Decide whether external research is needed.
4. If research is needed:
   - Create a targeted prompt in `prompts/dev-research/<short-topic>.md`.
   - Run `research-xm` with a bounded profile.
   - Inspect `run_summary.md` first.
   - Inspect `report_review.md` second.
   - Inspect `report.md` third.
5. Convert findings into a patch plan.
6. Implement the patch.
7. Run build, typecheck, and tests.
8. Summarize which research run informed the patch.
9. Commit only intended files.

When the reviewer or critique identifies gaps, generate a follow-up prompt without starting a run:

```powershell
corepack pnpm research-xm follow-up latest --write-prompt-only
```

This writes `runs/<runId>/follow_up_prompt.md`. A human or Codex can inspect and edit that prompt before any new research run.

Use Context7 MCP for current library/API documentation and examples when changing code against external packages. Context7 is not a replacement for `research-xm`: it answers library documentation questions, while `research-xm` produces sourced research artifacts and follow-up recommendations.

## Recommended Run Sizes

Smoke or quick:

```powershell
corepack pnpm research-xm run `
  --file .\prompts\dev-research\<topic>.md `
  --profile smoke5 `
  --max-tasks 1 `
  --concurrency 1

[console]::beep(880,700)
```

Medium:

```powershell
corepack pnpm research-xm run `
  --file .\prompts\dev-research\<topic>.md `
  --profile normal100 `
  --max-tasks 3 `
  --concurrency 1 `
  --focus web `
  --search-provider opencode-web `
  --researcher-mode extract `
  --review-report `
  --notify `
  --verbose

[console]::beep(880,700)
```

Deep-ish:

```powershell
corepack pnpm research-xm run `
  --file .\prompts\dev-research\<topic>.md `
  --profile deep500 `
  --max-tasks 12 `
  --concurrency 2 `
  --focus web `
  --search-provider opencode-web `
  --researcher-mode extract `
  --review-report `
  --notify `
  --verbose

[console]::beep(880,700)
```

Do not run full `deep500` without `--max-tasks` until a chunked or section writer exists.

## Reading Results

Read generated files in this order:

1. `runs/<runId>/run_summary.md` gives the fastest view of coverage, errors, reviewer quality, retries, and next actions.
2. `runs/<runId>/report_review.md` says whether the report is ready for use and what gaps remain.
3. `runs/<runId>/report.md` contains the full research result.
4. `runs/<runId>/usage.json` and `runs/<runId>/events.jsonl` are for debugging provider calls, retries, tokens, and partial failures.

## Safety Rules

- `research-xm` does not modify source code.
- Codex must not blindly apply research recommendations.
- Tests and repo evidence override external recommendations.
- The human owns the final commit decision.
- Do not commit run artifacts unless explicitly requested.
- Do not expose `.env`, API keys, or secrets.
- Do not create automatic commits from `research-xm`.
- Do not add timer-based automation or background daemons for this workflow.
- Inspect git status, recent log, unpushed commits, and the current branch before non-trivial edits.
- Work on a feature branch for implementation patches.
- Stage only intended files; never stage `.env`, `runs/`, zip archives, `.idea/`, or scratch artifacts.
