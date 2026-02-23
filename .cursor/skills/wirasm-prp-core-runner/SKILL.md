---
name: wirasm-prp-core-runner
description: Runs the full PRP delivery workflow from feature request to pull request with /prp-core-run-all. Use when the user asks for end-to-end PRP implementation, full PRP workflow automation, or feature-to-PR execution.
---

# PRP Core Workflow Runner

## When To Use

Apply this skill when the user wants the full PRP lifecycle in one run, for example:

- "run the full PRP workflow"
- "implement this feature with PRP and open a PR"
- "take this from idea to branch, implementation, commit, and PR"

Do not apply this skill when the user only wants a single PRP sub-step (for example only planning, only PRP doc generation, or only PR creation).

## Execution Workflow

1. Extract a concise feature description from the user request.
2. Invoke:
   - `/prp-core-run-all <feature-description>`
3. Monitor execution and verify all stages complete in order:
   - create branch
   - generate PRP
   - execute implementation
   - create commit
   - create pull request
4. If any stage fails:
   - stop immediately
   - report the failed stage and direct error cause
   - provide concrete next actions
   - do not continue to later stages
5. If successful:
   - confirm completion
   - return the pull request URL

## Response Format

Use concise, operational updates:

- **In progress:** current stage and what is being validated.
- **On failure:** failed stage, reason, exact remediation steps.
- **On success:** completion confirmation and PR link.

## Guardrails

- Do not invent missing feature details; ask a focused clarification if scope is ambiguous.
- Do not skip failed validation steps.
- If `/prp-core-run-all` is unavailable, report that clearly and propose the equivalent manual PRP sequence.

## Examples

### Example 1

User: "Implement JWT auth using PRP and open a PR."
Action: `/prp-core-run-all Implement JWT authentication`

### Example 2

User: "Run full PRP flow for Elasticsearch-backed search API."
Action: `/prp-core-run-all Add Elasticsearch-backed search API`
