# v0.5 Next Patches Reminder

Read this file before proposing or implementing any v0.5 work.

The full v0.5 roadmap is intentionally deferred and must not be started automatically. P1 only adds token honesty and quota mode. Do not expand P1 into provider work, section writing, coverage/source scoring, GitHub inspection, Langfuse, a web UI, a database, a vector store, LangGraph, or an MCP server.

Before implementing any of P2-P6, ask the user for approval and confirm scope.

## Remaining Patch List

### P2 - coverage_matrix.json + source_quality.json

Goal:
Understand what was actually covered and how trustworthy sources are.

### P3 - --report-depth + section writer

Goal:
Improve report depth without over-compressing, using outline/sections/assembler.

### P4 - GitHub repo inspection, but only after user approval

Goal:
Read README/package/src/docs from GitHub repos when a research topic depends on code-level evidence.

Important:
User does not currently have gh CLI installed.
Prefer REST/raw fallback if ever implemented.
Do not add this in P1.

### P5 - task_state/* + early-stage resume

Goal:
Resume failed search/researcher tasks without repeating expensive completed work.
Do not add this in P1.

### P6 - Codex handoff artifacts

Goal:
Generate implementation_backlog.json and codex_patch_plan.md for downstream coding agents.
Do not add this in P1.
