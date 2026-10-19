# Testing and acceptance

Targeted TypeScript/build+unit per task; full E2E and golden rendering at milestones. Do not chase arbitrary coverage counts or promise FPS before benchmark.

## TST-001 — Unit
Scenario: Создание Project с одним Model и одной Scene
Covers: FR-001..FR-003
Owner task: TASK-001

## TST-002 — Unit
Scenario: Parenting и запрет циклических отношений
Covers: FR-005
Owner task: TASK-017

## TST-003 — Unit
Scenario: Batch selection, hide/lock, undo
Covers: FR-006..FR-009
Owner task: TASK-011

## TST-004 — Integration
Scenario: Сериализация/десериализация self-contained проекта
Covers: FR-010..FR-011
Owner task: TASK-010

## TST-005 — Negative
Scenario: Битый manifest / неверный формат файла
Covers: FR-011;NFR-002
Owner task: TASK-010

## TST-006 — Unit
Scenario: Primitive parameter bounds и валидность сетки
Covers: FR-012
Owner task: TASK-016

## TST-007 — Geometry
Scenario: Boolean subtract torus, holes и manifoldness
Covers: FR-014
Owner task: TASK-020

## TST-008 — Geometry
Scenario: Boolean union/intersect + rollback
Covers: FR-015;NFR-003
Owner task: TASK-022

## TST-009 — Unit
Scenario: Mirror/radial array parameter update
Covers: FR-016..FR-017
Owner task: TASK-023

## TST-010 — Geometry
Scenario: Stack reorder, disable modifier и deps invalidate
Covers: FR-019
Owner task: TASK-021

## TST-011 — E2E
Scenario: Brush preview → stroke → undo
Covers: FR-021
Owner task: TASK-026

## TST-012 — Negative
Scenario: Non-manifold CSG rollback unchanged state
Covers: FR-025;NFR-003
Owner task: TASK-028

## TST-013 — Visual
Scenario: Chrome/Glass/Stone golden scene
Covers: FR-027..FR-035
Owner task: TASK-035

## TST-014 — Asset
Scenario: PNG/HDR/EXR import, color spaces, file limits
Covers: FR-031
Owner task: TASK-032

## TST-015 — Unit
Scenario: Seeded procedural texture reproducibility
Covers: FR-033
Owner task: TASK-034

## TST-016 — Renderer
Scenario: WebGPU selected vs WebGL2 fallback and unsupported hints
Covers: FR-037;NFR-009
Owner task: TASK-036

## TST-017 — Animation
Scenario: t→pose deterministic keys and interpolation
Covers: FR-040..FR-043
Owner task: TASK-038

## TST-018 — Animation
Scenario: Loop t=0 vs t=T position and tangent
Covers: FR-044
Owner task: TASK-043

## TST-019 — E2E
Scenario: Timeline playback rate and graph easing
Covers: FR-042..FR-045
Owner task: TASK-041

## TST-020 — Animation
Scenario: Spin on group + child translation
Covers: FR-047
Owner task: TASK-042

## TST-021 — Extended
Scenario: Proximity magnet release does not reset phase
Covers: FR-048..FR-049
Owner task: TASK-051

## TST-022 — Extended
Scenario: Rule DSL forbids executable scripts
Covers: FR-050
Owner task: TASK-052

## TST-023 — Extended
Scenario: Collision dynamic bounce + kinematic limitation warning
Covers: FR-052
Owner task: TASK-053

## TST-024 — E2E
Scenario: Workbench resize, tooltips, keyboard-only nav
Covers: FR-057..FR-061
Owner task: TASK-012

## TST-025 — E2E
Scenario: Cancel long job preserves document and unlocks UI
Covers: FR-062..FR-063
Owner task: TASK-027

## TST-026 — Integration
Scenario: GLB import, invalid extension diagnostics
Covers: FR-064
Owner task: TASK-010

## TST-027 — Security
Scenario: Static TSX import no eval on malicious source
Covers: FR-066..FR-067
Owner task: TASK-054

## TST-028 — Export
Scenario: TSX from ring+chrome+animation compiles in clean Vite
Covers: FR-068..FR-071
Owner task: TASK-048

## TST-029 — Export
Scenario: Quality profiles non-destructive and warnings
Covers: FR-073..FR-074
Owner task: TASK-046

## TST-030 — Extended
Scenario: GLB export reload no unknown semantics claims
Covers: FR-072
Owner task: TASK-056

## TST-031 — Extended
Scenario: WebM duration exact, optional MP4 feature detection
Covers: FR-075
Owner task: TASK-057

## TST-032 — E2E
Scenario: Manual save, close tab, reload no data, reopen file
Covers: FR-008..FR-011;NFR-001
Owner task: TASK-013

## TST-033 — Performance
Scenario: 100/1000/5000 objects: memory and operation timings
Covers: NFR-005;NFR-017
Owner task: TASK-063

## TST-034 — Security
Scenario: ZIP slip, fake image MIME, compressed bomb reject
Covers: NFR-002;NFR-016
Owner task: TASK-062

## TST-035 — Deployment
Scenario: Fresh clone build and Pages base smoke
Covers: NFR-013..NFR-014
Owner task: TASK-049
