# Changelog

## Unreleased

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
