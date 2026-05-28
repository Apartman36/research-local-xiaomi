# research-xm Commands Reference

Short practical reference for common `research-xm` commands and options.

## Main commands

```powershell
research-xm run [options] [prompt]
research-xm list
research-xm show <run>
research-xm validate <run>
research-xm summary <run>
research-xm follow-up <run> --write-prompt-only
research-xm follow-up <run> --execute
research-xm resume <run>
research-xm smoke
```

- `run` starts a research pipeline from an inline prompt or `--file`.
- `list` prints local run IDs.
- `show <run>` prints quick metadata for a run.
- `validate <run>` checks report citations against `sources.json`.
- `summary <run>` prints or generates `run_summary.md`.
- `follow-up <run> --write-prompt-only` writes `follow_up_prompt.md` for a targeted next research run without executing it.
- `follow-up <run> --execute` writes `follow_up_prompt.md` and starts a new child run with lineage metadata.
- `resume <run>` continues a failed writer, report reviewer, citation lint, or summary stage from existing artifacts in the same run directory.
- `smoke` tests Xiaomi chat, or Xiaomi native Web Search with `--web`.

`<run>` may be `latest` or an explicit run ID. `latest` uses the timestamp embedded in run IDs such as `2026-05-28T09-13-54-582Z-xm` before considering stable metadata from artifacts, and falls back to directory modified time only when no stable timestamp is available. If `latest` is surprising, pass an explicit run ID.

## Common run profiles

`smoke5`

- small pipeline test
- about 1 task / 5 sources
- use for smoke and debugging

`normal100`

- normal profile
- use with `--max-tasks 3` to `8` for controlled research

`deep500`

- deep profile
- do not use uncapped yet
- use `--max-tasks` until chunked writer/resume exists

## Focus modes

`web` searches the broad web. Use it for general market, docs, product, provider, or best-practice research.

`github` asks the planner and search prompt to focus on repositories, READMEs, examples, issues, discussions, changelogs, and source architecture. Use it for implementation strategy and open-source comparison.

## Search providers

`opencode-web`

- default
- uses OpenCode websearch
- OpenCode token accounting may be unavailable due to early exit

`xiaomi-native`

- experimental
- may fail with `webSearchEnabled=false`

## Researcher modes

`extract`

- default
- Xiaomi researcher extraction per task
- higher quality

`mechanical`

- fallback/debug
- cheaper/faster
- less useful for real reports

## Report review

`--review-report` writes `report_review.json` and `report_review.md`. The review includes `readyForUse`, `readinessScore`, source quality notes, gaps, and recommendations.

`readinessScore` uses a small honest scale:

- `-2`: harmful / misleading / should not be used
- `-1`: weak / incomplete / risky
- `0`: mixed / partial / needs follow-up
- `1`: useful with caveats
- `2`: strong / ready for intended use

Old `qualityScore` artifacts still display in summaries for backward compatibility. Invalid `readinessScore` values are not clamped; they normalize conservatively to `-1 / weak`, preserve `invalidReadinessScore`, and add a validation warning. If `scoreLabel` conflicts with `readinessScore`, the numeric score wins.

If reviewer JSON parsing fails, `report_review_raw.txt` is saved, `Report review parsing: fallback` appears in summaries, and the fallback review uses `readinessScore: -1 / weak`.

`--no-review-report` skips report QA artifacts for faster debugging.

## Network/retry options

`--opencode-timeout-ms` controls the OpenCode subprocess timeout.

`--opencode-retries` controls transient OpenCode search retries.

`--xiaomi-timeout-ms` controls the default Xiaomi role timeout for planner, researcher extraction, critic, writer, and report reviewer.

`--writer-timeout-ms` overrides the Xiaomi timeout for the writer only.

Examples:

- normal Wi-Fi: `--opencode-retries 2`
- unstable Wi-Fi: `--opencode-retries 3`
- diagnostic timeout failure: `--opencode-timeout-ms 1`

## Concurrency

`--concurrency` controls concurrent researcher work.

- `1` for debugging/stability
- `2` for normal
- `3` if stable

## Task cap

`--max-tasks` caps planned research tasks.

Source estimate:

- 1 task ~= 5 raw sources
- 3 tasks ~= 15 raw sources
- 5 tasks ~= 25 raw sources
- 8 tasks ~= 40 raw sources
- 12 tasks ~= 60 raw sources

## Useful recipes

### Smoke test

```powershell
corepack pnpm research-xm run `
  --file .\prompts\interior-design-3d-ai-smoke.md `
  --profile smoke5 `
  --focus web `
  --search-provider opencode-web `
  --max-tasks 1 `
  --opencode-timeout-ms 60000 `
  --opencode-retries 2 `
  --concurrency 1 `
  --researcher-mode extract `
  --review-report `
  --notify `
  --verbose

[console]::beep(880,700)
```

### Medium GitHub research

```powershell
corepack pnpm research-xm run `
  --file .\input\<topic>.md `
  --profile normal100 `
  --focus github `
  --search-provider opencode-web `
  --max-tasks 5 `
  --opencode-timeout-ms 180000 `
  --opencode-retries 2 `
  --concurrency 1 `
  --researcher-mode extract `
  --review-report `
  --notify `
  --verbose

[console]::beep(880,700)
```

### Retry diagnostic run

```powershell
corepack pnpm research-xm run `
  --file .\prompts\interior-design-3d-ai-smoke.md `
  --profile smoke5 `
  --focus web `
  --search-provider opencode-web `
  --max-tasks 1 `
  --opencode-timeout-ms 1 `
  --opencode-retries 2 `
  --concurrency 1 `
  --researcher-mode extract `
  --review-report `
  --verbose

[console]::beep(880,700)
```

### Show/validate/summary latest

```powershell
corepack pnpm research-xm show latest
corepack pnpm research-xm validate latest
corepack pnpm research-xm summary latest

[console]::beep(880,700)
```

### Create run archive

```powershell
Compress-Archive -Path .\runs\<run-id>\* -DestinationPath .\runs\<run-id>.zip

[console]::beep(880,700)
```

Do not commit run archives unless explicitly requested.

### Follow-up prompt generation

```powershell
corepack pnpm research-xm follow-up latest --write-prompt-only

[console]::beep(880,700)
```

This writes `runs/<run-id>/follow_up_prompt.md` and does not start a new run.

### Follow-up execution

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

This creates a child run under `runs/<child-run-id>/`. The child `config.json` contains `parentRunId`, `isFollowUpRun`, `followUpDepth`, `followUpReason`, `gapsAddressed`, and `followUpPromptPath`. Exactly one of `--write-prompt-only` or `--execute` is required.

Execution is limited to depth 1. If `latest` resolves to a child follow-up run, the error explains the current depth and suggests `research-xm follow-up <parentRunId> --execute` when `parentRunId` is available. Prompt-only mode is still allowed on child runs.

### Resume failed run

```powershell
corepack pnpm research-xm resume latest `
  --writer-timeout-ms 300000 `
  --notify `
  --verbose

[console]::beep(880,700)
```

```powershell
corepack pnpm research-xm resume 2026-05-28T09-13-54-582Z-xm `
  --writer-timeout-ms 300000 `
  --notify `
  --verbose

[console]::beep(880,700)
```

Supported resume stages:

- `writer`: requires `plan.json`, `sources.json`, `evidence.json`, and `critique.json`.
- `reportReviewer`: requires those artifacts plus `report.md`.
- `citationLint`: requires `report.md` and `sources.json`.
- `summary`: regenerates `run_summary.md` from available artifacts.

Resume only works for runs created after `state.json` support was added. Legacy runs without `state.json` fail read-only and are not mutated. Completed runs report that there is nothing to resume. After a supported stage is selected, resume writes/updates `state.json`, appends resume events to `events.jsonl`, and does not rerun planner/search/researcher/critic for supported late-stage failures. It does not resume incomplete OpenCode search/extraction work yet.

## Prompt locations

`input/` is local scratch for one-off prompts and is ignored by git. `prompts/` contains reusable committed prompt fixtures.

## Troubleshooting

### Codex cannot see project skills

Codex must start from the repository root:

```text
C:\Users\hustlePC\PycharmProjects\research-local-xiaomi
```

Check that `.codex/skills/use-research-xm/SKILL.md` and `docs/COMMANDS_REFERENCE.md` are visible. If not, Codex is likely in the wrong workspace.

### Report reviewer returned malformed JSON

Open `runs/<run-id>/report_review_raw.txt` and `runs/<run-id>/report_review.md`. The fallback review is conservative and uses `readinessScore: -1 / weak`.

### OpenCode token accounting unavailable

Early-exit OpenCode runs may not emit final token accounting. `usage.json` and `run_summary.md` report `OpenCode tokens: unavailable (early exit)` instead of treating zero as a real token count.
