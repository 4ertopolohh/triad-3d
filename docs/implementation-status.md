# Implementation status

## TASK-010B — Basic static GLB import

- Added bounded GLB 2.0 preflight and `GLTFLoader` geometry check, rejecting external URIs, extensions, animations and unsupported scene structures before commit.
- A confirmed import registers SHA-256 asset metadata and an identity transform mesh node in one domain transaction; bytes stay in RAM and round-trip through `.triad3d`. The Russian UI offers a separate import action, confirmation, diagnostics and a visible model entry.
- TASK-010 / FR-064 remain partial: broader glTF scene and animation import, editable imported materials, and production 3D rendering are not implemented.

## TASK-010A — Native project archive and manual file actions

- Added `.triad3d` ZIP save/open with `manifest.json`, `document.json`, SHA-256 verified binary assets, strict entry/path checks, and bounded streaming extraction. Asset bytes remain in RAM and are excluded from JSON and command history.
- EditorStore now replaces a validated loaded project and its asset store in one publication, resets selection/history, keeps serialized `model.revision`, and rejects stale asynchronous replacements. Confirmed File System Access writes mark the captured revision clean; browser download fallback reports only that download was initiated.
- Added Russian save/open controls and status messages. Security limits are temporary protective bounds pending performance profiling: 128 MiB archive, 256 MiB expanded, 1024 entries, 64 MiB per asset, 16 MiB document, 1 MiB manifest.
- TASK-010 remains partial: the GLB/GLTF import adapter is not included in TASK-010A.

## TASK-009 — Versioned project JSON serialization

- Added strict JSON Schema 2020-12 contracts for `Project` document v1 and native manifest v1, with Ajv 8 validation, domain integrity checks, bounded input scanning, typed errors, and a pure migration chain API. No older migration is registered.
- Serializing and parsing stay pure and disconnected from EditorStore. ZIP packaging, asset bytes/checksums, file dialogs, and replacement of the active project remain TASK-010.
- Targeted round-trip and malformed-input tests cover geometry hierarchy, materials, animation, modifiers, references, version handling, numeric corruption, nesting, and unsafe archive paths.

## TASK-007 — Domain commands and transactions

- Implemented a typed, in-memory Command Bus for adding leaf nodes, renaming, transforms, and visibility/lock flags. Commands validate targets and permissions, stage an isolated candidate, and commit once after `validateProject` succeeds.
- Session transaction revision starts at zero; successful content changes advance it once and also advance `model.revision` once for these model-node commands. Semantic no-ops advance neither.
- Forward and inverse field/node deltas can be replayed with `applyProjectPatch`; snapshots and command results are defensive copies. Editor store, history, and UI integration remain future tasks.
- Verification: 28 targeted domain tests, typecheck, lint, and production build passed.

## TASK-004 — TSX export harness spike

- Completed a narrow Project-to-TSX generator and an isolated React/Three Vite harness. The automatically generated component passes TypeScript and production build after `npm ci` in a directory outside the repository.
- Targeted export tests, domain regression, root typecheck/lint/build, and WebGL smoke passed. Supported fields and omissions are recorded in [tsx-export-feasibility.md](tsx-export-feasibility.md). Production TASK-044 remains open.

## TASK-003 — CSG/Manifold WASM spike

- Изолированный прототип `src/spikes/csg/`, dev-маршрут `/?spike=csg`, целевые тесты и отчёт [csg-feasibility.md](csg-feasibility.md).
- Subtract/union/intersect и базовая проверка сетки прошли; UV и исходные нормали не сохраняются. ADR-003 остаётся PROPOSED.

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
