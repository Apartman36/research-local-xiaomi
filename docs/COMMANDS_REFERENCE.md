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
research-xm smoke
```

- `run` starts a research pipeline from an inline prompt or `--file`.
- `list` prints local run IDs.
- `show <run>` prints quick metadata for a run.
- `validate <run>` checks report citations against `sources.json`.
- `summary <run>` prints or generates `run_summary.md`.
- `follow-up <run> --write-prompt-only` writes `follow_up_prompt.md` for a targeted next research run without executing it.
- `smoke` tests Xiaomi chat, or Xiaomi native Web Search with `--web`.

`<run>` may be `latest` or an explicit run ID.

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

`--review-report` writes `report_review.json` and `report_review.md`. The review includes `readyForUse`, quality score, source quality notes, gaps, and recommendations.

`--no-review-report` skips report QA artifacts for faster debugging.

## Network/retry options

`--opencode-timeout-ms` controls the OpenCode subprocess timeout.

`--opencode-retries` controls transient OpenCode search retries.

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
