---
name: waypoint-v1-run
description: Waypoint v1 is executed phase-by-phase against plan.md (10 phases, P0-P6 ratified); plan.md's constraints table overrides stale details in initial-plan.md
metadata:
  type: project
---

Waypoint v1 build (started 2026-07-07) runs as sequential phase execution: executor and reviewer agents consume one phase at a time from `/Users/tyler/prj/waypoint/plan.md`. The architecture in `initial-plan.md` is ratified (all §20 decisions locked) and must not be re-litigated; where the two documents conflict, plan.md's "Ratified decisions & run constraints" table wins (e.g., npm name is `waypoint-md`, confirmed available 2026-07-07 — §12's "name pending" is stale).

**Why:** the run has environment constraints not in the design doc: local-only (no GitHub remote, CI authored but never runs — reviewer's local gate run substitutes), no npm publishing this run, local dev shell is Node v20.19.5 while the project pins 22 (commands must not assume `nvm use`), and `ANTHROPIC_API_KEY` arrives later in a gitignored `.env` (never block on it).

**How to apply:** when re-planning, splitting phases, or answering questions mid-run, treat plan.md as the authoritative contract and preserve the ratified P0-P6 ordering, the ≤10 phase cap, and the byte-fidelity invariant (`applyReview(raw, {}) === raw`; round-trip recovers state) as the #1 non-negotiable across every phase.
