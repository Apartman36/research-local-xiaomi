# Self-Audit Workflow

`research-local-xiaomi` can help improve itself or another codebase, but the research system should not automatically modify code.

The safer pattern is:

```text
research -> insights -> recommendations -> Codex patch -> tests -> commit -> next version
```

Research can identify architecture options, gaps, risks, and examples from similar systems. A coding agent or developer should still translate that evidence into a scoped patch, run tests, inspect the diff, and commit intentionally.

## Recommended Workflow

1. Snapshot project context.
   Include the README, changelog, project overview, current architecture, known limitations, and the exact improvement question.

2. Write a self-audit research prompt.
   Use `prompts/research-local-xiaomi-self-audit.md` as a starting point.

3. Run `research-xm`.
   Start with a smoke or medium profile before a deep run.

4. Read the key artifacts.
   Start with `run_summary.md`, then inspect `report.md` and `report_review.md`.

5. Convert recommendations into a Codex patch prompt.
   Ask for a focused implementation plan with explicit non-goals, tests, and acceptance criteria.

6. Codex implements changes.
   Keep changes scoped. Do not let the research runner modify source files directly.

7. Run tests.
   Use build, typecheck, unit tests, and a real smoke run when the change affects orchestration.

8. Commit.
   Stage only intended files and write a clear commit message.

9. Repeat.
   Feed lessons learned into future prompts and docs.

## Why Not Fully Autonomous Self-Modification

Fully autonomous self-modification collapses research, judgment, implementation, verification, and commit authority into one loop. That increases the risk of:

- implementing weak recommendations without review;
- changing architecture beyond the intended scope;
- hiding failing tests behind generated optimism;
- committing local artifacts or secrets;
- creating feedback loops where the system reinforces its own mistakes.

The current project keeps research and code modification separate. That makes every patch reviewable, testable, and reversible.

## Future v0.3 Artifacts

These are proposed for a future knowledge loop, not implemented in v0.2.1:

- `insights.json`
- `implementation_backlog.json`
- `architecture_decisions.md`
- `codex_patch_plan.md`
- `risk_register.md`
- `knowledge/research-log.md`
- `knowledge/backlog.md`
- `knowledge/architecture-decisions.md`
- `knowledge/lessons-learned.md`

In v0.3, these artifacts should still be advisory. The CLI should not automatically edit source code, run git commits, or merge changes based only on research output.
