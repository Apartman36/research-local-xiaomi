# Use research-xm for decision-point research

## When to use

Use `research-xm` when:

- architecture is uncertain
- best practices may have changed
- comparing tools/libraries/providers
- debugging repeated failures
- external docs/current info are needed
- looking for similar GitHub/open-source solutions
- planning v0.x roadmap or large refactor

Do not use `research-xm` for:

- trivial edits
- simple type errors
- formatting
- local-only known code paths
- every 10 minutes by timer

## Standard command

```powershell
corepack pnpm research-xm run `
  --file .\prompts\dev-research\<topic>.md `
  --profile normal100 `
  --focus web `
  --search-provider opencode-web `
  --max-tasks 3 `
  --opencode-timeout-ms 120000 `
  --concurrency 1 `
  --researcher-mode extract `
  --review-report `
  --notify `
  --verbose

[console]::beep(880,700)
```

## After running

Read in this order:

1. `runs/<runId>/run_summary.md`
2. `runs/<runId>/report_review.md`
3. `runs/<runId>/report.md`
4. `usage.json` and `events.jsonl` only if debugging

## How to use findings

- Convert findings into a patch plan.
- Keep implementation scoped.
- Cite the run ID in final response.
- Do not auto-commit unless the user asked.
- Do not let research override tests or repo evidence.
