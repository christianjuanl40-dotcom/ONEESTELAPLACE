# Project Working Guide

Use the root documentation as persistent project context for future prompts.

## Read first

At the start of each task, read in this order:

1. [README.md](README.md) — product, setup, routes, and commands.
2. [ARCHITECTURE.md](ARCHITECTURE.md) — module/data-flow map, APIs, and business invariants.
3. [DESIGN_PALETTE.md](DESIGN_PALETTE.md) — palette, tokens, typography, and component conventions.

For CMS work, also read [CMS_ARCHITECTURE.md](CMS_ARCHITECTURE.md). Read [IMPROVEMENTS.md](IMPROVEMENTS.md) when historical hardening context is relevant; its test/lint/audit counts are historical.

After these references, use the architecture's task-to-file map and inspect the implementation needed for the user's request. Avoid a full-repository discovery scan when the documentation already locates the feature. Current source/configuration takes precedence if documentation has drifted; correct the affected reference when that happens.

## Implementation conventions

- Check the working-tree state before editing and preserve existing user changes.
- Keep feature code in `src/modules/client`, `src/modules/admin`, or `src/modules/shared`, with route/layout/API entry points under `app/`.
- Reuse UI primitives from `src/modules/shared/components/ui/`, existing import aliases, and the surrounding file's style.
- Follow the active providers mounted by `global-provider.tsx`. Root `components/` mixes older implementations with still-used adapters; trace imports before choosing one.
- Keep payment, availability, cancellation, date, and status calculations aligned with the canonical helpers identified in `ARCHITECTURE.md`.
- Preserve ownership and permission checks in APIs and Firestore rules when changing data workflows.
- Use `DESIGN_PALETTE.md` for UI work. The orange brand is commonly applied with `orange-*` utilities; `bg-primary` is currently charcoal.
- Use `.env.example` for configuration names; keep real credential values out of source, docs, and output.

## Verification

Use the commands in `README.md` appropriate to the change. Business-logic changes should exercise the relevant existing tests; rules tests need the Firestore emulator. Report the checks actually run and whether any suite skipped.

For documentation-only changes, verify source claims, file references, Markdown structure, and `git diff --check`. An application build is not needed solely for Markdown edits.

## Keep project memory current

Update the relevant guide in the same task when changing:

- **README.md:** setup, environment variables, dependencies, scripts, or routes.
- **ARCHITECTURE.md:** modules, providers, APIs, data relationships, or business behavior.
- **DESIGN_PALETTE.md:** brand colors, tokens, fonts, shared layouts, or component patterns.
- **CMS_ARCHITECTURE.md:** CMS document shape, editors, assets, or persistence flow.

Keep these guides concise and navigable so later prompts can start here instead of rediscovering the project.
