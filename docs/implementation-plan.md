# Codex implementation plan

Complete dependencies in order. Estimates are planning targets, not commitments. Each task must result in working code and targeted checks.

## 0. Discovery/Spikes

### TASK-001 — Согласовать конечные типы document graph (MVP)
- Depends on: —
- Do: Определить Project/Model/Scene/Node/Modifier/Material/Timeline/Asset; запретить циклические ссылки и положить fixtures в репозиторий.
- Artifact: domain types + fixtures
- Check: tsc + schema fixtures
- Estimate: 2–4 ч

### TASK-002 — Spike WebGPU/WebGL2 и PBR (MVP)
- Depends on: TASK-001
- Do: Рендер хрома, стекла, нормалей и HDRI в обеих ветках; зафиксировать отличия, стабильный baseline и fallback.
- Artifact: renderer-decision.md + prototype
- Check: snapshot двух режимов
- Estimate: 2–4 ч

### TASK-003 — Spike CSG+Manifold WASM (MVP)
- Depends on: TASK-001
- Do: Проверить тор с отверстиями, пересечение и отмену, стоимость вычислений и UV/normals на результатах.
- Artifact: CSG feasibility report
- Check: геометрия без degenerate mesh
- Estimate: 2–4 ч

### TASK-004 — Spike TSX export harness (MVP)
- Depends on: TASK-001
- Do: Создать минимальный тестовый генератор компонента и проверку Vite/TS без настоящего редактора.
- Artifact: harness project
- Check: npm run build
- Estimate: 2–4 ч

### TASK-005 — Собрать интерфейсные и технические токены (MVP)
- Depends on: —
- Do: Перенести цветовые и типографические token names из Triad Studio с учётом прав на шрифты; спроектировать compact desktop spacing.
- Artifact: design tokens
- Check: visual QA
- Estimate: 2–4 ч

## 1. Foundation

### TASK-006 — Создать Vite React TypeScript приложение (MVP)
- Depends on: TASK-001;TASK-005
- Do: Создать структуру packages/app/core/render/geo/anim/export/ui; ESLint, TS strict, CI build commands.
- Artifact: monorepo/workspace skeleton
- Check: npm ci + build
- Estimate: 2–4 ч

### TASK-007 — Внедрить команды и транзакции (MVP)
- Depends on: TASK-006
- Do: Typed commands execute/invert, failure rollback, error code; avoid mutation outside dispatcher.
- Artifact: command bus
- Check: atomicity unit tests
- Estimate: 2–4 ч

### TASK-008 — Реализовать in-memory store (MVP)
- Depends on: TASK-007
- Do: State slices document/selection/tool/view/job/history; selectors and derived cache invalidation.
- Artifact: editor state
- Check: store unit tests
- Estimate: 2–4 ч

### TASK-009 — Создать сериализацию проекта schema v1 (MVP)
- Depends on: TASK-001;TASK-008
- Do: JSON schema manifest, IDs, asset refs, version/migrations API, roundtrip fixture.
- Artifact: serializer/deserializer
- Check: golden roundtrip
- Estimate: 2–4 ч

### TASK-010 — Добавить файл .triad3d и архиватор (MVP)
- Depends on: TASK-009
- Do: Zip manifest/document/assets, checksums, safe path validation, explicit save/import buttons; отдельный базовый GLTFLoader adapter для импорта GLB без вреда source scene.
- Artifact: file adapter
- Check: corrupt archive tests
- Estimate: 2–4 ч

### TASK-011 — Реализовать Undo/Redo delta history (MVP)
- Depends on: TASK-007;TASK-008
- Do: Command reversible diffs, coalescing drag edits, memory snapshots/checkpoints in RAM.
- Artifact: history store
- Check: 100 ops replay
- Estimate: 2–4 ч

### TASK-012 — Собрать базовый layout и topbar (MVP)
- Depends on: TASK-006;TASK-005
- Do: Resizable left/right docks, viewport center, bottom timeline, modes, error/toast, desktop-only notice.
- Artifact: UI shell
- Check: E2E layout smoke
- Estimate: 2–4 ч

### TASK-013 — Предупреждение об unsaved состоянии (MVP)
- Depends on: TASK-010;TASK-012
- Do: Dirty flag, user-activated beforeunload, explicit save, no browser persistent storage.
- Artifact: leave-warning
- Check: reload cannot restore
- Estimate: 2–4 ч

## 2. Geometry

### TASK-014 — Создать Three renderer adapter (MVP)
- Depends on: TASK-002;TASK-012
- Do: Scene sync from domain graph, renderer lifecycle, context loss recovery, dispose resources.
- Artifact: renderer adapter
- Check: context restart
- Estimate: 2–4 ч

### TASK-015 — Orbit controls, gizmos и picking (MVP)
- Depends on: TASK-014
- Do: Orbit camera, fit/reset, world/local transform widgets, ray picking, snap.
- Artifact: viewport interactions
- Check: E2E select/move
- Estimate: 2–4 ч

### TASK-016 — Библиотека геометрических примитивов (MVP)
- Depends on: TASK-001;TASK-014
- Do: Parametric typed primitive factory, segmentation and bounds validation, lazy mesh evaluate.
- Artifact: primitive factory
- Check: unit geometry tests
- Estimate: 2–4 ч

### TASK-017 — Дерево модели и группировка (MVP)
- Depends on: TASK-012;TASK-016
- Do: Hierarchy DnD, selection multi, visibility/lock, protected roots, ID consistency.
- Artifact: object tree
- Check: cycle prevention tests
- Estimate: 2–4 ч

### TASK-018 — Инспектор transform/primitive (MVP)
- Depends on: TASK-015;TASK-017
- Do: Numeric fields, mixed values, validation, reset, undo coalescing.
- Artifact: inspector
- Check: UI unit tests
- Estimate: 2–4 ч

### TASK-019 — Интегрировать BVH и surface picking (MVP)
- Depends on: TASK-015;TASK-016
- Do: Accelerated raycast for triangle surfaces, hit data local coords, worker build for heavy models.
- Artifact: surface query API
- Check: raycast validation
- Estimate: 2–4 ч

### TASK-020 — Интегрировать CSG WASM worker (MVP)
- Depends on: TASK-003;TASK-019
- Do: Typed worker protocol, manifold input/output conversion, geometry checks, cancellation boundaries.
- Artifact: CSG service
- Check: boolean fixtures
- Estimate: 2–4 ч

### TASK-021 — Добавить modifier graph evaluator (MVP)
- Depends on: TASK-020;TASK-009
- Do: Ordered modifiers and cached intermediate geometry with dependency invalidation and error fallback.
- Artifact: modifier service
- Check: toggle reorder tests
- Estimate: 2–4 ч

### TASK-022 — Boolean UI отверстия/объединения (MVP)
- Depends on: TASK-020;TASK-021
- Do: Cutter selection, preview and apply, parameter edit, error explain.
- Artifact: boolean tools
- Check: torus hole E2E
- Estimate: 2–4 ч

### TASK-023 — Mirror and radial/linear arrays (MVP)
- Depends on: TASK-021
- Do: Deterministic repeats with seed/pivot/angle, optional instancing; editable params.
- Artifact: array/mirror modifiers
- Check: symmetry tests
- Estimate: 2–4 ч

### TASK-024 — Basic vertex/edge/face editing (MVP)
- Depends on: TASK-016;TASK-019
- Do: Subselection, translate/extrude, validity checks, undo semantic operations.
- Artifact: mesh editor
- Check: topology fixtures
- Estimate: 2–4 ч

### TASK-025 — Базовые bend/twist/taper/bevel (MVP)
- Depends on: TASK-021
- Do: Typed modifiers, stable normals, deterministic updates, performance thresholds.
- Artifact: deform modifiers
- Check: geometry tests
- Estimate: 2–4 ч

### TASK-026 — Surface material/paint brush (MVP)
- Depends on: TASK-019;TASK-018
- Do: Brush cursor preview, radius/intensity/fill, symmetry stencil, one stroke transaction.
- Artifact: brush UI and engine
- Check: brush E2E
- Estimate: 2–4 ч

### TASK-027 — Управление тяжёлыми jobs (MVP)
- Depends on: TASK-020;TASK-012
- Do: Modal UI lock, job queue one at time, progress messages, cancel/rollback/crash recovery.
- Artifact: job controller
- Check: cancel test
- Estimate: 2–4 ч

### TASK-028 — Валидация сетки и диагностические ошибки (MVP)
- Depends on: TASK-020;TASK-024
- Do: Manifold/degenerate checks, error code hints with precise cause and safe undo.
- Artifact: mesh diagnostics
- Check: invalid input tests
- Estimate: 2–4 ч

## 3. Materials

### TASK-029 — Сервис материалных сущностей (MVP)
- Depends on: TASK-001;TASK-014
- Do: PBR typed schema, material slots, ID refs, fallback materials, GPU dispose.
- Artifact: material service
- Check: serialization unit
- Estimate: 2–4 ч

### TASK-030 — Реалистичные preset preview cards (MVP)
- Depends on: TASK-029;TASK-012
- Do: Metal/glass/stone/abstract preview sphere with standard HDRI; preset classification and filtering.
- Artifact: preset library
- Check: visual golden
- Estimate: 2–4 ч

### TASK-031 — Drag-drop и Inspector материалов (MVP)
- Depends on: TASK-029;TASK-018
- Do: Material assignment from catalog, basic+advanced sliders, shared/unique slots, undo.
- Artifact: material UI
- Check: E2E assignment
- Estimate: 2–4 ч

### TASK-032 — Ассеты: import images/HDR/EXR (MVP)
- Depends on: TASK-010;TASK-029
- Do: Asset ingest, MIME signature, size cap, URLs lifetime, color space, resource refcounts.
- Artifact: asset adapter
- Check: bad asset rejection
- Estimate: 2–4 ч

### TASK-033 — Текстурные mapping UV/box/triplanar (MVP)
- Depends on: TASK-031;TASK-016
- Do: UV handling, mapping selector, supported fallback and warning for missing UV.
- Artifact: mapping service
- Check: texture visual QA
- Estimate: 2–4 ч

### TASK-034 — Процедурный noise/scratches (MVP)
- Depends on: TASK-029;TASK-032
- Do: Seeded generators for grain/metal scratches/stone patterns; optional bake for export.
- Artifact: procedural maps
- Check: seed repeat test
- Estimate: 2–4 ч

### TASK-035 — Свет, HDRI и tone mapping (MVP)
- Depends on: TASK-031;TASK-014
- Do: Environment picker, light transform/intensity, exposure, metal/glass golden scene.
- Artifact: lighting tools
- Check: golden render compare
- Estimate: 2–4 ч

### TASK-036 — Draft/Quality/Final preview (MVP)
- Depends on: TASK-002;TASK-035
- Do: Feature capability matrix, render profile switch and graceful fallback.
- Artifact: render profiles
- Check: switch consistency
- Estimate: 2–4 ч

## 4. Animation

### TASK-037 — Типизированная timeline domain model (MVP)
- Depends on: TASK-001;TASK-008
- Do: Tracks, channels, keys, easing, fps/time/duration, loop metadata.
- Artifact: timeline types
- Check: schema roundtrip
- Estimate: 2–4 ч

### TASK-038 — Animation evaluator t→pose (MVP)
- Depends on: TASK-037
- Do: Deterministic absolute time evaluation for transforms, pivot and interpolation.
- Artifact: anim engine
- Check: property/key tests
- Estimate: 2–4 ч

### TASK-039 — Таймлайн UI и tracks (MVP)
- Depends on: TASK-037;TASK-012
- Do: Playback, scrub, add keys, drag, ruler, loop region, collapse.
- Artifact: timeline UI
- Check: E2E keys
- Estimate: 2–4 ч

### TASK-040 — Две точки и keyframe запись (MVP)
- Depends on: TASK-039;TASK-015
- Do: Link gizmo edits to current frame, set start/end keys, separate camera input.
- Artifact: record key UI
- Check: two-point smoke
- Estimate: 2–4 ч

### TASK-041 — Bezier graph и slow playback (MVP)
- Depends on: TASK-039;TASK-038
- Do: Curve handles, easing presets, playback rate 0.1–2, timeline duration independence.
- Artifact: curve editor
- Check: curve shape tests
- Estimate: 2–4 ч

### TASK-042 — Presets spin/orbit/move/reveal (MVP)
- Depends on: TASK-038;TASK-039
- Do: Preset factory maps config to tracks; pivot rotation and parameter panel.
- Artifact: animation presets
- Check: preset golden
- Estimate: 2–4 ч

### TASK-043 — Loop continuity analyzer (MVP)
- Depends on: TASK-038;TASK-041
- Do: Compare first/last pose and velocity/tangent; fix or warn with exact differences.
- Artifact: loop assistant
- Check: t0 vs tT tests
- Estimate: 2–4 ч

## 5. MVP export

### TASK-044 — Создать runtime TSX generator (MVP)
- Depends on: TASK-004;TASK-031;TASK-038
- Do: From domain graph generate TSX and typed Props, no editor dependency; controlled resources.
- Artifact: TSX generator
- Check: clean harness build
- Estimate: 2–4 ч

### TASK-045 — ZIP с ресурсами и README (MVP)
- Depends on: TASK-044;TASK-032
- Do: Package TSX/assets/npm deps/readme/licenses, relative paths and deterministic names.
- Artifact: ZIP artifact
- Check: unzip build smoke
- Estimate: 2–4 ч

### TASK-046 — Экспортный мастер и три профиля (MVP)
- Depends on: TASK-045;TASK-036
- Do: Max/Balanced/Lite profiles, preview, stats/compat warning, no source mutation.
- Artifact: export dialog
- Check: profile smoke
- Estimate: 2–4 ч

### TASK-047 — Генератор и инспектор props (MVP)
- Depends on: TASK-044;TASK-046
- Do: User selects exposable params size/color/speed etc, validation and default values.
- Artifact: props UI
- Check: prop controls exported
- Estimate: 2–4 ч

### TASK-048 — Проверка save/reopen/export сценария (MVP)
- Depends on: TASK-010;TASK-047
- Do: End-to-end ring+chrome+spin→save→reload/import→TSX in harness.
- Artifact: E2E MVP acceptance
- Check: complete flow
- Estimate: 2–4 ч

### TASK-049 — Static GitHub Pages build (MVP)
- Depends on: TASK-006;TASK-048
- Do: Base path, no server assumptions, asset URL handling, smoke deploy.
- Artifact: Pages config
- Check: deployed preview test
- Estimate: 2–4 ч

## 6. Extended

### TASK-050 — Синхронизация model instances (NEXT)
- Depends on: TASK-017;TASK-021
- Do: Revision snapshots, explicit Sync, shared data and optional overrides.
- Artifact: instance subsystem
- Check: sync E2E
- Estimate: 2–4 ч

### TASK-051 — Layered interaction animation (NEXT)
- Depends on: TASK-038;TASK-043
- Do: Additive/override layers, priorities, cursor influence and smooth release.
- Artifact: animation mixer
- Check: spin+magnet test
- Estimate: 2–4 ч

### TASK-052 — Typed interaction rule DSL (NEXT)
- Depends on: TASK-051
- Do: Event/Condition/Action schemas and evaluator with safe predicates, no dynamic code.
- Artifact: rules engine
- Check: DSL tests
- Estimate: 2–4 ч

### TASK-053 — Rapier collision service (NEXT)
- Depends on: TASK-051
- Do: Dynamic/static/kinematic actors with documented limitations, mass/restitution, collision event mapping.
- Artifact: physics adapter
- Check: bounce fixtures
- Estimate: 2–4 ч

### TASK-054 — Code source AST importer (NEXT)
- Depends on: TASK-001;TASK-010
- Do: Allowlist TSX/JSX/HTML AST, diagnostic mapping, no eval and no network.
- Artifact: source importer
- Check: security regression
- Estimate: 2–4 ч

### TASK-055 — Процедурные stamps/детали (NEXT)
- Depends on: TASK-023;TASK-026
- Do: Brush stamp holes/spikes with non-destructive mirror arrays, seed and undo.
- Artifact: advanced brushes
- Check: golden complex model
- Estimate: 2–4 ч

### TASK-056 — GLB/GLTF exporter + loss report (NEXT)
- Depends on: TASK-044;TASK-038
- Do: GLTFExporter with supported clips/materials, report unsupported interactions and shaders.
- Artifact: GLB export
- Check: roundtrip test
- Estimate: 2–4 ч

### TASK-057 — Видео WebM и опциональный MP4 (NEXT)
- Depends on: TASK-038;TASK-036
- Do: Frame renderer fixed step, WebCodecs/MediaRecorder feature matrix, FFmpeg WASM fallback spike.
- Artifact: video export
- Check: duration/frame smoke
- Estimate: 2–4 ч

### TASK-058 — Библиотеки пресетов и packs (NEXT)
- Depends on: TASK-010;TASK-029
- Do: Import/export versioned packs and assets with zip safety/duplicate resolution.
- Artifact: preset pack tools
- Check: pack roundtrip
- Estimate: 2–4 ч

### TASK-059 — Final path tracing эксперимент (NEXT)
- Depends on: TASK-002;TASK-036
- Do: Evaluate path tracer capability on golden scenes, capture limitations and fallback.
- Artifact: final render optional
- Check: visual comparative QA
- Estimate: 2–4 ч

### TASK-060 — Texture & geometry optimization (NEXT)
- Depends on: TASK-032;TASK-046
- Do: Meshopt simplify/weld/compress and image conversion in-browser with measured quality losses.
- Artifact: optimizer
- Check: size stats + visual comparison
- Estimate: 2–4 ч

## 7. Release

### TASK-061 — Прогнать визуальные golden сценарии (MVP)
- Depends on: TASK-036;TASK-048
- Do: Metal, glass, stone, HDRI at fixed camera/time; capture engine/browser/version.
- Artifact: golden QA report
- Check: approved screenshots
- Estimate: 2–4 ч

### TASK-062 — Проверить security/privacy and RAM-only (MVP)
- Depends on: TASK-054;TASK-056
- Do: Malformed assets, ZIP-slip, memory lifecycle, no persistence after refresh, beforeunload.
- Artifact: security checklist
- Check: negative E2E
- Estimate: 2–4 ч

### TASK-063 — Профилирование сложных сцен (MVP)
- Depends on: TASK-027;TASK-060
- Do: Measure geometry compute, render and memory on known Windows+GPU, record limitations without invented fps targets.
- Artifact: performance baseline
- Check: profile review
- Estimate: 2–4 ч

### TASK-064 — Документация и совместимость релиза (MVP)
- Depends on: TASK-061;TASK-062;TASK-063
- Do: Update README, supported formats, version matrix, operation caveats and exports install guide.
- Artifact: release docs
- Check: fresh-clone run
- Estimate: 2–4 ч
