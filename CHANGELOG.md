# Changelog

## Unreleased

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
