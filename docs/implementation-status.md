# Implementation status

## TASK-002 — Renderer/PBR spike

- Изолированный dev-прототип `/?spike=renderer` с WebGPU preferred и Forced WebGL2, локальным CC0 HDRI и диагностикой backend.
- Встроенный браузер Codex: фактически WebGPU и WebGL2, обе эталонные сцены сняты при 1280×800; подробности в [renderer-decision.md](renderer-decision.md).
- `npm run typecheck`, `npm run lint`, `npm test` (9 тестов), `npm run build` проходят. ADR-004 остаётся PROPOSED до проверки в Chrome/Edge и на других GPU.

## TASK-006 — React/Vite foundation

- Integrated the existing domain API and design tokens into a single React/Vite/TypeScript SPA.
- The initial Russian desktop screen is structural; rendering, editing, timeline controls, and persistence are future tasks.
- The document remains in memory only. No browser storage or backend is used.
- `nodes` is a flat entity collection with `parentId`/`children` hierarchy links. This supports stable IDs and serialization. TASK-007 commands must update both links atomically and validate before commit; renderer synchronization should derive from committed domain revisions. No blocking architectural conflict found.
- TASK-001 and TASK-005 files remain intact. The token fixture is served by Vite at `/tests/visual/design-tokens.html`.
- Verification: `npm run typecheck`, `npm run lint`, `npm test` (9 tests), and `npm run build` pass. Vite HTTP smoke confirmed the SPA and token fixture load. The available in-app browser has a narrow viewport; full desktop-width visual QA remains open.
