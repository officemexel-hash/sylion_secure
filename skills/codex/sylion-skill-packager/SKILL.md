---
name: sylion-skill-packager
description: Maintain the SYLION skill set for Codex and Claude Code. Use when creating, updating, syncing, testing, or packaging SYLION skills and shared references for both agent environments.
---

# SYLION Skill Packager

## Mission

Keep Codex and Claude Code SYLION skills aligned while respecting each tool's skill format.

## Packaging Rules

- Each skill must have one clear capability.
- `description` must include when to use the skill.
- Keep `SKILL.md` concise and link to references.
- Do not duplicate large references inside every skill.
- Keep shared project facts in `skills/shared/references/`.
- Do not add README or extra docs inside a skill directory.
- Every SYLION skill must reference `human-gate-policy.md` or embed an equivalent human-gate rule.

## Sync Workflow

1. Update shared references first.
2. Update Codex skill.
3. Port equivalent instructions to Claude Code skill.
4. Ensure names and descriptions remain trigger-friendly.
5. Check safety boundaries for PHANTOM content.
6. Validate that router conflict rules remain present in relevant skills.
7. Validate that uncertain, high-impact decisions trigger `HUMAN GATE REQUIRED`.

## Output

- Skills changed.
- Shared references changed.
- Behavioral change summary.
- Compatibility notes for Codex and Claude Code.
