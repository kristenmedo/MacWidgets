---
name: merge
description: Mark the current PR ready for review and enable auto-merge once required checks and approvals pass.
disable-model-invocation: true
---

Mark the current pull request ready for review and enable auto-merge, so it merges only when all required checks and approvals pass.

1. Find the PR for the current branch. If there is none, say so and stop.
2. If it is a draft, mark it ready for review.
3. Enable auto-merge, using the repository's allowed merge method.
4. Report the PR link, its state (ready, auto-merge on or off), and what it is still waiting on (checks, approvals).

Rules:
- Do not bypass protections: no admin override, no force-merge, no merging directly, no editing branch protection or required checks, and no dismissing or requesting around reviews.
- If auto-merge can't be enabled (not allowed on the repo, or a merge conflict), say why and stop. Don't work around it.
- Do not push, edit, or merge anything else.
