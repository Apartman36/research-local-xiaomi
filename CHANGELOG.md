# Changelog

## Unreleased

### v0.4 foundation

- Added real Agent Skills-style `.codex/skills/use-research-xm/SKILL.md`.
- Added `docs/COMMANDS_REFERENCE.md` as a concise command and option reference.
- Added safe `research-xm follow-up <run> --write-prompt-only` prompt generation.
- Added explicit `research-xm follow-up <run> --execute` child runs with parent lineage metadata.
- Added `state.json` checkpoints and `research-xm resume <run>` for late-stage writer/reviewer/citation/summary recovery.
- Fixed resume so missing-state legacy runs, completed runs, and unsupported early-stage states are validated read-only before any `state.json` or event mutation.
- Changed `latest` run resolution to prefer stable run timestamps over directory modified time so follow-up prompt writes do not reorder runs.
- Added `--xiaomi-timeout-ms` and `--writer-timeout-ms` for role call timeout control.
- Replaced future report reviewer scoring with `readinessScore` on the `-2..2` scale while preserving old `qualityScore` display.
- Normalized invalid reviewer scores conservatively instead of clamping high invalid values into `strong`.
- Hardened report reviewer parsing for fenced/prose-surrounded JSON and saved malformed raw output for fallback review inspection.
- Added `tokenAccounting` to `usage.json` so direct Xiaomi tokens, OpenCode subprocess usage, estimates, lower-bound status, quota risk, and warnings are explicit.
- Added `--quota-mode conservative|normal|aggressive` to `run` and `follow-up --execute`.
- Added prompt preflight normalization before planning, with `normalized_request.json`, `normalized_request.md`, `prompt_preflight_failed`, and `--no-prompt-normalize` for debugging old planner behavior.
- Added `docs/V05_NEXT_PATCHES_REMINDER.md` to keep deferred v0.5 work out of P1 unless the user explicitly approves scope.
- Improved follow-up depth errors so child runs point back to `parentRunId` when execution is blocked.
- Documented `input/` as ignored scratch and `prompts/` as committed reusable prompt fixtures.
- Updated README and workflow docs with Context7, follow-up prompt, and git/workflow safety expectations.

### v0.3 foundation

- Added Codex decision-point research workflow docs in `docs/CODEX_RESEARCH_WORKFLOW.md`.
- Added `.codex/skills/use-research-xm.md` for Codex operational guidance in this repo.
- Added `prompts/dev-research-template.md` for targeted development research prompts.
- Added lightweight knowledge seed files in `knowledge/research-log.md` and `knowledge/backlog.md`.
- Added `--opencode-retries` with bounded OpenCode websearch retry support for unstable Wi-Fi.
- Added OpenCode retry attempt/failure events and run summary retry diagnostics.

### v0.2.1

- Added `run_summary.md` as a compact human-friendly overview written after each run.
- Added `research-xm summary <run>` with `latest` resolution and `--path`.
- Improved final console output with summary path, researcher/report-reviewer calls, review readiness, quality score, and OpenCode early-exit token status.
- Added `docs/PROJECT_OVERVIEW.md` for future agents and research runs.
- Added `docs/SELF_AUDIT_WORKFLOW.md` describing a safe research-to-Codex patch workflow.
- Added `prompts/research-local-xiaomi-self-audit.md` as a self-audit research fixture.
- Added real Xiaomi researcher extraction per search task, enabled by default with `--researcher-mode extract`.
- Added non-fatal researcher fallback to mechanical claims when extraction fails or returns malformed JSON.
- Hardened planner parsing with invalid/missing focus coercion and deterministic fallback plans.
- Added Xiaomi report review QA artifacts: `report_review.json` and `report_review.md`.
- Added OpenCode usage summary improvements for calls, websearch/webfetch calls, and unavailable early-exit tokens.
- Added `--notify` for best-effort success/failure audio notifications.
- Updated gitignore and committed reusable prompt fixtures for smoke/follow-up runs.
- Added `--search-provider <opencode-web|xiaomi-native>` with `opencode-web` as the default.
- Added OpenCode JSON event parsing, websearch output parsing, OpenCode usage aggregation, and provider events.
- Kept Xiaomi native Web Search as an experimental provider with a clear `webSearchEnabled is false` error.
- Updated dry-run artifacts, config, usage, tests, and README for the provider architecture.

## 0.1.0 MVP

- Initial standalone TypeScript CLI.
- Added Xiaomi MiMo chat and web-search client.
- Added local research orchestration pipeline with planner, researcher, critic, writer, source dedupe, citation linting, and usage accounting.
- Added `normal100` and `deep500` profiles.
- Added optional future OpenCode example files that are not used by the CLI.
