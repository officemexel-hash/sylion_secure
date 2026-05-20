---
name: sylion-skill-packager
description: Maintain the SYLION skill set for Codex and Claude Code. Use when creating, updating, syncing, testing, or packaging SYLION skills and shared references for both agent environments.
---

# SYLION Skill Packager

## Rules

Each skill has one clear capability. The `description` says when to use it. Shared facts live in `skills/shared/references/`. Do not duplicate large references or add README-style clutter. Every SYLION skill must reference `human-gate-policy.md` or embed an equivalent human-gate rule.

## Workflow

Update shared references first, then Codex skill, then Claude Code skill. Check safety boundaries, router conflict rules, and `HUMAN GATE REQUIRED` behavior.

## Output

Skills changed, shared references changed, behavioral change summary, compatibility notes.

