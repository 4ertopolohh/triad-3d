# Implementation status

## TASK-027 — Transactional Heavy Job Controller (MVP)

- `EditorStore.jobs.run(spec)` validates a detached Project snapshot, runs one asynchronous computation with `AbortSignal` and optional progress, then commits prepared typed commands through one CommandBus transaction. `cancelJob()` and `dispose()` terminate the active lifecycle; late results and progress are ignored. Read-only jobs leave document, dirty state and history untouched.
- Active jobs block EditorStore document/history writes, project replacement, save confirmation, selection and tool changes. The Russian modal overlay uses `inert` for background controls, exposes actual progress or an indeterminate indicator, diagnostics, and Cancel when supported. Renderer synchronization still follows derived generation rather than progress updates.
- Targeted tests cover lifecycle, atomic Undo, validation, concurrent starts, cancellation, Worker diagnostics, stale context, mutation guards, invalid commit, progress and disposal. TST-025 remains pending as a full browser E2E scenario until Boolean UI can start a real long operation. No Boolean modifier commands or UI were added.

## TASK-021 — Modifier Graph Evaluator (MVP)

- `src/geometry/modifiers/` evaluates primitive and locally resolved asset meshes through ordered Boolean stacks using the existing CSG service. Dependencies, hierarchy transforms, self and indirect cycles, invalid references and parameters receive typed diagnostics. Unsupported modifier kinds remain explicit errors.
- Derived stages live only in a configurable byte-bounded LRU cache. Keys include source content, modifier identity/version/order/parameters, cutter stages and influencing world matrices. Results are copied at API boundaries. Errors can return the last valid stage as a marked fallback; cancellation and stale Project detection do not publish a result.
- `SceneSync` still renders source geometry. Boolean UI, modifier editing commands, and general modifier algorithms remain later tasks. CSG output retains XYZ/triangles only; UV and material groups/slots are lost and normals need recomputation for display.

## TASK-018 — Inspector трансформаций и параметров примитивов

- Правая панель показывает числовые Position/Rotation/Scale в local/world, mixed values, reset, видимость/блокировку и контекстную геометрию. Редактирование нескольких узлов проходит одной атомарной транзакцией; числовой ввод использует короткий preview debounce и один Undo-шаг на сеанс поля. Esc и отклонённый ввод удаляют предпросмотр и его запись истории через `cancelGesture`.
- World-преобразования пересчитываются в локальные через матрицу родителя и отклоняются при shear, вырождении или отрицательном детерминанте. Одновременная world-правка предка и потомка явно запрещена. Формы защищены от устаревшей ревизии, смены проекта, выделения и режима.
- Шесть примитивов остаются параметрическими; GLB отображается как readonly. Параметры куба канонизируются при переходе от `size` к отдельным размерам. Scene mode сохраняет Inspector только для просмотра модели.
- Проверки: typecheck, lint, 61 целевой Vitest тест и production build прошли. Встроенный браузер с desktop viewport подтвердил создание куба, изменение положения, Undo/Redo, редактирование размера, ошибку нулевого масштаба и откат предпросмотра по Esc. Полный сценарий gizmo/group/save/reopen в браузере не проверен. Большой Vite chunk остаётся прежним предупреждением.

## TASK-014 — Three.js renderer adapter

- The editor stage now renders the committed Project graph with a persistent WebGPURenderer, WebGPU preferred and forced WebGL2 diagnostics. Stable node IDs retain Object3D instances across ordinary revisions; local transforms, visibility, camera, background, lights, primitives, domain PBR fields, and RAM-backed static GLB are reflected in the preview.
- GPU geometry, materials, and textures are disposed when sources disappear or change, and asynchronous GLB results cannot attach after project replacement or viewport teardown. The renderer owns its canvas, resize observer, frame loop, and context-loss listeners. A graphics failure stops rendering and offers explicit retry from the current Project snapshot.
- Scene mode labels the primary model as a preview; it does not synthesize serialized instances. HDRI environment assets, Scene instances, material textures, and modifier evaluation are not yet rendered, with visible diagnostics. Actual device loss and cross-browser recovery remain unverified on hardware; the loss handler and retry were tested in isolation.
- In the in-app Chromium desktop viewport, Auto selected WebGPU and forced WebGL2 selected WebGL2. A local static GLB rendered, Undo/Redo changed the preview, and switching Model/Scene kept one canvas. Save/Open UI, dock resizing, and actual device loss were not browser-tested in this run.

## TASK-013 — Unsaved changes and RAM-only lifecycle

- The editor registers a `beforeunload` guard only while the document is dirty, removes it when clean or unmounted, and checks the current store snapshot before requesting the browser confirmation. New/Open confirmations and manual save semantics remain unchanged.
- The project and history remain in tab memory. A confirmed reload starts a fresh session; reopening a saved project requires explicit file selection. Browser dialog behavior still requires a desktop browser smoke check.

## TASK-012 — Desktop workspace and topbar

- Completed the Russian editor shell controls: model/scene mode, new project with dirty confirmation, library tab, resizable docks, collapsible timeline, Ctrl+S, accessible status messages, and a narrow-window notice.
- Reused EditorStore for mode/view and atomic project replacement. File actions share a synchronous UI lock; native save confirmation and download fallback retain their existing semantics. Production viewport, inspector, timeline editing, and export remain future tasks.
- Typecheck, lint, targeted EditorStore/archive/GLB tests, and production build pass. Narrow-screen notice was visually checked in the in-app browser; desktop-width browser smoke is still unverified in that browser's fixed narrow viewport.

## TASK-011 — Undo/Redo delta history

- Added a cursor over reversible command deltas, validated atomic replay through the existing CommandBus, redo branch truncation, and explicit gesture grouping. Session revisions remain monotonic while the serialized model revision follows the replayed patch.
- Saved state tracks a RAM-only history position. GLB bytes remain available for redo and are released when their history branch is discarded or the project is replaced. Undo/Redo buttons and keyboard shortcuts are available in the Russian topbar.
- Targeted tests cover 100 undo/redo steps, transaction and gesture grouping, checkpoints, stale revisions, lock flags, GLB replay and archive round-trip. No history is serialized.

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

## TASK-016 — Параметрическая библиотека примитивов (FR-012, FR-024)

- Добавлены единые определения и валидация шести примитивов в `src/geometry/primitives.ts`; фабрика Three.js использует их для вычисления геометрии по изменению source. Доменная проверка отклоняет неверные размеры, сегменты, неизвестные ключи и вырожденный цилиндр до фиксации проекта.
- Через левую «Библиотеку» можно создать примитив в корне Model с выделением; правая панель применяет числовые параметры отдельной обратимой командой. `SET_PRIMITIVE_PARAMETERS` соблюдает inherited lock/visibility, не изменяет asset-backed mesh и поддерживает Undo/Redo. Save/Open сохраняют source в схеме 1.0.0 без миграции.
- Изменены `src/geometry/primitives.ts`, `src/renderer/primitive.ts`, `src/domain/{command-bus,validate-project}.ts`, `src/ui/App.tsx`, `src/ui/styles/app.css`; добавлен `tests/renderer/primitives.test.ts`.
- Проверки: typecheck, lint, 84 целевых Vitest теста, build — успешно. Браузерный smoke UNVERIFIED: встроенный браузер доступен только в узком viewport и показывает desktop-only notice. Существующее предупреждение Vite о размере bundle остаётся. Полный Inspector и production TSX export остаются отдельными задачами.

## TASK-019 — BVH и Surface Picking (MVP)

- Добавлен runtime `SurfaceQuery`: ближайшее пересечение мирового луча с видимым статическим Mesh, координаты world/mesh-local/node-local, геометрическая нормаль, faceIndex и UV при наличии. Viewport использует этот API для выбора узлов.
- `three-mesh-bvh@0.9.16` подключён локально к поддерживаемым Mesh без изменения прототипов Three.js. Для сеток от 20 000 треугольников BVH строится одним переиспользуемым Worker; проверка и копирование входных буферов выполняются порциями. Порог является начальной эвристикой. Пока BVH не готов или построение завершилось ошибкой, используется штатный raycast; ошибка отражается в диагностике viewport.
- Индексы живут только в runtime. SceneSync освобождает их при замене геометрии, удалении узла, смене проекта и dispose. Изменение transform или материала не перестраивает BVH. Skinned/morph Mesh, повреждённые сетки и сетки более 2 млн треугольников не индексируются; повреждённые сетки не участвуют в запросе.
- Целевые тесты покрывают indexed/non-indexed, шесть примитивов, вложенные трансформации, normal matrix, видимость предков, locked selection, worker success/failure/late result и жизненный цикл геометрии. Browser smoke и замер ускорения отдельно не подтверждены.

## TASK-020 — Production CSG WASM Worker (MVP)

- `src/geometry/csg/` предоставляет `CsgService.run({ jobId, operation, target, cutter }, signal?)`, `cancel(jobId?)` и `dispose()`. Вход — копируемые XYZ/indices и необязательные column-major local-to-world матрицы; результат — derived mesh в локальной системе target, `empty`, статистика, предупреждения и `faceOrigins`. `Project`, история и SceneSync не меняются. Spike использует production service через тонкий адаптер.
- Manifold 3.5.4 выполняет subtract/union/intersect в Worker. Индексы, конечность чисел, площади треугольников и состояние Manifold проверяются; плохой вход и ответ Worker отвергаются типизированными ошибками. Отрицательный determinant относительного преобразования исправляет winding копии cutter. Повторное конкурентное задание получает `JOB_BUSY`; отмена уничтожает Worker и допускает новый запуск. Буферы входов копируются до transfer. Лимит 64 MiB на совокупные входные буферы и 5-минутный watchdog защитные, не измеренный бюджет производительности.
- `faceOrigins` использует документированные Manifold `runOriginalID`/`runFlags`: 0 — target, 1 — cutter, 2 — новая поверхность вычитания. UV, авторские normals и группы/слоты материалов на выход не переносятся; предупреждения описывают потерю. `toThree()` пересчитывает normals только для просмотра. Peak WASM/браузерная память, сложные импортированные solids и другие браузеры не профилированы. ADR-003 остаётся PROPOSED; пользовательские Boolean-инструменты относятся к следующим задачам.
- Целевые Vitest (15), полный набор (153), typecheck, lint и build проходят. Во встроенном браузере dev-маршрут выполнил subtract в Worker (`NoError`), отменил высокодетальный job (`JOB_CANCELLED`) и завершил повторный запуск (`NoError`).
