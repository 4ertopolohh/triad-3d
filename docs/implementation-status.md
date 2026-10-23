# Implementation status

## CODEX-024B — Выбор и численное перемещение вершин (часть TASK-024)

- Inspector явно преобразует поддерживаемый примитив в Editable Mesh через CommandBus. Object/Vertex mode и выбранные render vertex indices хранятся только в EditorStore и очищаются при потере допустимости или замене проекта.
- Viewport выбирает вершину по SurfaceQuery, треугольнику и экранному допуску; Shift добавляет, Ctrl переключает. Совпадающие UV seam vertices представлены одной точкой. Временные GPU-инстансы следуют иерархии узла и освобождаются при смене режима и dispose. Локальное смещение через Inspector создаёт одну обратимую команду; объектный gizmo и горячие клавиши трансформации в Vertex mode отключены.
- Desktop browser smoke: Cube → Editable Mesh → vertex click → X translation → Undo/Redo проверен в WebGPU/WebGL2; GPU-маркеры визуально подтверждены в WebGL2. Системный save picker встроенного браузера не дал завершить ручной save/reopen smoke; native archive round trip изменённой сетки с UV подтверждён тестом. TASK-024 и FR-013 остаются частичными: Edge/Face, extrude и масштабирование элементов не реализованы.
- Проверки: `npm run typecheck`, `npm run lint`, `npm run build` PASS; целевые тесты 34 PASS. Полный `npm test` перед итоговой правкой визуальных маркеров: 32 файла, 251 тест PASS; после неё целевые тесты повторены. Сборка сохраняет существующее предупреждение о крупном chunk.

## CODEX-024A — Editable mesh domain foundation (часть TASK-024)

- Project schema 1.1.0 stores JSON editable positions, triangle indices and optional UV. Strict v1.0 documents migrate in memory; ZIP manifest remains 1.0.0. Invalid geometry is rejected before project replacement.
- Explicit primitive conversion and local vertex translation use CommandBus patches with Undo/Redo. Coincident render vertices at UV seams move together; invalid or degenerate geometry rolls back. SceneSync and ModifierEvaluator derive detached geometry from Project. Inspector identifies editable meshes; spike TSX rejects them explicitly.
- Active modifier stacks and Boolean dependents block these edit commands until pre-commit derived validation is available. Visual sub-selection, gizmos, extrude and topology tools remain in TASK-024. Browser smoke verified desktop layout, schema 1.1.0 and cube creation in WebGPU; editable geometry was verified through renderer tests because this stage has no conversion/edit UI.
- Final checks: `npm run typecheck`, `npm run lint`, `npm run build`, and `npm test` PASS (31 files, 246 tests; isolated TSX harness typecheck/build PASS). Build retains the existing large-chunk warning. CODEX-024A acceptance is covered at API, serialization, renderer and evaluator levels; full TASK-024 and FR-013 remain partial.

## CODEX-023C — Mirror commands и Inspector (TASK-023)

- Добавлены типизированные ADD/UPDATE Mirror команды с проверкой параметров, доступности mesh, уникальности ID, версий и обратимых патчей. Общие команды стека работают с Mirror без отдельной истории.
- `mirror-actions` проверяет изолированный кандидат и полный итоговый активный стек до единственного commit; ошибка evaluator, отмена и устаревшая ревизия не фиксируют изменения. Inspector показывает русскоязычные параметры Mirror и явно различает Boolean, Array и Mirror. Добавление Mirror к GLB отключено до реализации resolver геометрии.
- FR-017, FR-019 и TST-009 реализованы на уровне команд, транзакций, вычислителя и UI. Полный набор до последнего расширения целевых тестов: 232 passed; typecheck, lint и build прошли. Browser smoke остаётся UNVERIFIED: встроенный браузер показывает только сообщение о недостаточной ширине desktop viewport. Ограничения CSG и `MeshData` описаны ниже. Статус TASK-023: IMPLEMENTED_UNVERIFIED.

## CODEX-023B — Детерминированное ядро Mirror (часть TASK-023)

- Mirror принимает строгие `axes` (`x/y/z/xy/xz/yz/xyz`), локальный `pivot` и `mergeSeam`. Оригинал и сочетания отражений вычисляются в порядке битовых масок X=1, Y=2, Z=4; нечётные отражения меняют winding. Буферы результата отделены от входа, ограничены 64 MiB, поддерживают отмену и валидируются до публикации.
- `mergeSeam: false` соединяет только triangle buffers и выдаёт предупреждение о возможных совпадениях, касаниях и пересечениях. `mergeSeam: true` последовательно применяет существующий Manifold/CSG union к полным замкнутым телам; открытая/невалидная сетка и пустой результат отклоняются. Union не обрезает исходную половину mesh по плоскости, не гарантирует одну связную компоненту и не заменяет Blender-подобный clipping/welding. UV, авторские нормали и группы/слоты материалов не переносятся в текущем `MeshData`.
- Mirror включён в ordered `ModifierEvaluator` и его стадийный кеш; валидация Project проверяет параметры также у отключённого модификатора. Документ и архив v1 сохраняют Mirror без изменения схемы. Команды редактирования, Inspector и пользовательская приёмка остаются вне CODEX-023B; FR-017 остаётся PARTIAL.
- Проверки: typecheck, lint, 81 целевой Vitest тест (включая реальные Manifold union и отказ для открытой сетки), build — PASS. Browser/аппаратный сценарий — UNVERIFIED.

## CODEX-023A — Linear/radial Array (часть TASK-023)

- Реализованы строгие параметры, детерминированное локальное вычисление линейного и радиального массива с проверкой памяти/отменой, ordered evaluator, доменная валидация и существующие команды/UI Array. Это не завершает Mirror и весь TASK-023.

## CODEX-022C — Boolean UI и проверка до commit

- Inspector показывает русскоязычный Boolean-инструмент и стек: выбор замкнутых примитивов, Subtract/Union/Intersect, замена резака, включение, порядок и удаление. GLB и плоскость имеют явное ограничение. Опция скрытия резака входит в одну транзакцию с добавлением модификатора.
- `boolean-actions` применяет команды к изолированному кандидату через CommandBus, проверяет результат `ModifierEvaluator` с `AbortSignal` внутри JobController и только затем фиксирует исходные команды одним Undo-шагом. Если после отключения или удаления остаются активные стадии, кандидат также вычисляется до commit. Отклонённые операции не меняют Project, dirty-state и историю. Обычный ModifierPreview обновляет SceneSync после commit.
- Проверки: typecheck, lint, 51 целевой тест, полный набор 197 тестов и build прошли. Browser smoke UNVERIFIED: доступный in-app browser показывает только узкое desktop-only состояние. UV, исходные нормали и material groups/slots не сохраняются CSG; последующие правки трансформаций cutter остаются реактивным preview с диагностикой при отказе, без предварительной транзакционной проверки.

## TASK-022A — Boolean modifier commands (часть TASK-022)

- CommandBus поддерживает добавление, изменение, включение, перестановку и удаление Boolean-модификаторов через атомарные транзакции и обратимые патчи. Существующий EditorStore публикует изменения в истории и инвалидирует derived generation.
- Доменная проверка контролирует точные Boolean-параметры, владельца и порядок стека, ссылки на mesh и циклы зависимостей, включая отключённые модификаторы. Удаление используемого cutter отклоняется. Сохранение использует прежний документ v1.
- Boolean UI и подключение ModifierEvaluator к SceneSync остаются следующими частями TASK-022.

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

## CODEX-024C — Выбор и численное перемещение рёбер и граней (часть TASK-024)

- Режимы «Рёбра» и «Грани» используют тот же runtime `meshEdit`, SurfaceQuery и команду переноса вершин. Геометрические рёбра дедуплицируются по UV seams; грань является связной почти копланарной областью треугольников. Shift добавляет, Ctrl переключает выбор.
- Выделение отображается временным overlay, следует трансформациям узла и освобождается при смене режима/геометрии/renderer. После геометрического изменения выбор рёбер и граней очищается, чтобы идентификаторы не относились к прежней сетке. Проект и архив не содержат runtime selection.
- Численное локальное смещение проходит через `TRANSLATE_EDITABLE_VERTICES`, валидацию и Undo/Redo. Extrude и масштабирование элементов остаются незавершёнными; TASK-024 остаётся PARTIAL.
- Проверки: typecheck, lint, целевые Vitest и build прошли. Ручной browser smoke для CODEX-024C не выполнен (UNVERIFIED).

## CODEX-024D — Численное масштабирование элементов Editable Mesh (часть TASK-024)

- `scaleEditableVertices` масштабирует выбранные геометрические вершины относительно общего локального центра и обновляет совпадающие render vertices на UV seams. Результат проверяется после Float32; вырожденная или нечисловая геометрия отклоняется целиком. Единичное и фактически неизменное масштабирование не создаёт историю.
- `SCALE_EDITABLE_VERTICES` проходит через CommandBus с прежними проверками доступа, ревизии, модификаторов и зависимых Boolean. Inspector предоставляет русскоязычные поля X/Y/Z для Vertex/Edge/Face; одна выбранная вершина сопровождается объяснением недоступности. EditorStore сохраняет допустимый Vertex selection и очищает Edge/Face selection после изменения геометрии.
- Целевые Vitest: 6 файлов, 64 теста PASS; `npm run typecheck`, `npm run lint`, `npm run build` PASS. Подтверждены Undo/Redo, SceneSync/GPU disposal и round trip `.triad3d` на уровне тестов. Ручной browser smoke не выполнен (UNVERIFIED). Extrude остаётся незавершённым; TASK-024 и FR-013 остаются PARTIAL. Build сохраняет прежнее предупреждение о крупном chunk.

## CODEX-025A — Детерминированное ядро Bend / Twist / Taper (часть TASK-025)

- Реализованы локальные недеструктивные Bend (ось, направление, угол, pivot), Twist (ось, угол, pivot) и Taper (ось, начальный/конечный масштаб, pivot). Строгий разбор отклоняет лишние/отсутствующие поля, нечисловые значения и опасные диапазоны: углы ограничены 10 оборотами, чтобы ограничить повторное сворачивание и потерю точности, масштаб — 1e-6…1e6 для защиты от коллапса и чрезмерного усиления. Результат Float32, индексы и площади треугольников проверяются до публикации; большие проходы отдают управление event loop и поддерживают отмену.
- Этапы встроены в существующий упорядоченный ModifierEvaluator и его RAM cache с fallback. Доменная валидация проверяет также отключённые модификаторы; schemaVersion не изменялась. Предпросмотр использует прежний SceneSync с пересчётом нормалей и освобождением GPU-ресурсов.
- MeshData переносит только XYZ/индексы: UV, авторские нормали и группы материалов теряются с предупреждениями. Проверка не гарантирует отсутствие самопересечений или manifoldness. Bevel, команды/Inspector деформаций и остальная часть TASK-025 не реализованы; FR-018 остаётся частичным.
- Проверки: `npm run typecheck` PASS, `npm run lint` PASS, 7 целевых файлов Vitest / 85 тестов PASS, `npm run build` PASS. Build сохраняет существующее предупреждение о крупном chunk; ручной browser smoke не выполнен.

## CODEX-025B — Команды и Inspector Bend / Twist / Taper (часть TASK-025)

- Добавлены типизированные ADD/UPDATE-команды с проверкой параметров существующими парсерами; общий стек поддерживает enable, reorder и remove. ProjectPatch и одна Undo-запись на действие остаются прежними, семантическое обновление без изменений не создаёт историю.
- `deform-actions` предварительно применяет команду к изолированному Project, проверяет полный активный стек через ModifierEvaluator и фиксирует изменение через JobController только после успеха. Отмена и неудачная геометрия сохраняют документ и историю; для импортированного asset mesh без resolver операция заблокирована.
- Inspector показывает русскоязычный раздел деформаций и элементы в фактическом порядке стека. Draft-поля проверяются до команды, Enter/явная кнопка применяют параметры, Esc отменяет ввод; проверяются ревизия, эпоха проекта, выделение и версия модификатора.
- Подтверждены целевые Vitest для команд, действий и `.triad3d` round-trip, а также `typecheck`, `lint` и production build. Ручной browser smoke: UNVERIFIED. UV, авторские нормали и группы материалов после деформации не сохраняются; Bevel остаётся неподдерживаемым. TASK-025 и FR-018 остаются частичными.

## CODEX-025C — Геометрическое ядро Bevel (часть TASK-025)

- Односегментный плоский Bevel срезает выбранные острые рёбра выпуклого замкнутого ориентированного solid последовательными локальными плоскостями через установленный Manifold. Смежность определяется после объединения совпадающих render-вершин; копланарные диагонали не режутся. Нулевая ширина сохраняет историческую identity-семантику.
- Строгие `width` и необязательный `angleDegrees` (по умолчанию 30°) проверяются также для выключенного модификатора. `ModifierEvaluator` сохраняет порядок, кеш, fallback, отмену между синхронными WASM-срезами и предупреждения о потерянных атрибутах. Исходный Project и буферы не меняются; схема документа остаётся 1.1.0.
- Поддержка консервативна: до 4096 входных треугольников и 256 срезов, ширина меньше половины кратчайшего геометрического ребра; невыпуклые, открытые и непригодные сетки отклоняются. Буферы ограничены 64 MiB, но пик внутренней памяти WASM отдельно не профилирован. Отмена не прерывает уже начавшийся синхронный вызов WASM. UV, авторские нормали и группы материалов после реального среза не переносятся. Команды/Inspector для Bevel и произвольные невыпуклые сетки остаются для следующих этапов; TASK-025 остаётся частичным.

## CODEX-025D — Интеграция Bevel (завершение TASK-025)

- Bevel добавляется и редактируется через существующие команды и транзакционный action-layer. Общий стек поддерживает enabled, reorder, remove, Undo/Redo; эффективные 30° при отсутствующем `angleDegrees` не создают лишней истории.
- Inspector показывает поля ширины и порога, ограничения алгоритма и диагностические ошибки. Исходный meshSource остаётся без изменений; архив 1.1.0 сохраняет ID, порядок, version, enabled и параметры без изменения схемы.
- `typecheck`, `lint`, `build`, целевые и полные Vitest прошли (41 файл, 298 тестов). Ручной browser smoke: UNVERIFIED. Ограничения геометрического ядра и прерывания WASM из CODEX-025C сохраняются. TASK-025 реализован.
- **CODEX-026A / TASK-026 / FR-021 / UI-08 (PARTIAL):** Добавлена «Кисть: рельеф» для одного выбранного Editable Mesh в режиме «Модель»: локальные радиус/сила, BVH hit, подсветка затрагиваемых вершин, непрерывный мазок с интерполяцией, одна команда и один Undo/Redo. Отмена не меняет документ; архив `.triad3d` сохраняет результат. Лимиты: замкнутая согласованно ориентированная сетка до 20 000 render vertices, 512 точек мазка, радиус 0,01–10, сила −0,5…0,5, смещение за мазок не более 10% минимального ребра. Активные модификаторы/Boolean запрещены. Проверка вырождения и переворота треугольников не доказывает отсутствие всех самопересечений; Paint, Material Brush, fill и symmetry остаются в TASK-026. Typecheck, lint, целевые Vitest и build: результаты указаны в отчёте задания. Ручная браузерная проверка: UNVERIFIED — доступное окно встроенного браузера показывает только desktop-only экран.
- **CODEX-026B / TASK-026 / FR-021 / UI-08 / TST-011 (PARTIAL):** Displace Brush поддерживает выключенную симметрию и отражение по X/Y/Z относительно локальных плоскостей YZ/XZ/XY через начало mesh. Обе области показаны в предпросмотре и применяются одной транзакцией; пересечение и повторы samples объединяются по максимальному falloff. Параметры мазка фиксируются при pointerdown, смена параметров отменяет активный мазок. Старый payload команды сохраняет семантику `off`, невалидные значения отклоняются. Подтверждены typecheck, lint, 49 целевых тестов и production build; ручная браузерная проверка: UNVERIFIED. Существующие ограничения сетки и отсутствие полной гарантии против самопересечений сохраняются. Paint Brush, Material Brush и fill остаются в TASK-026.
- **CODEX-030A / TASK-030 (реализовано):** В левом dock добавлены разделы «Геометрия» и «Материалы», поиск и пять категорий. Шесть валидных PBR-пресетов показываются на статически отрендеренной сфере через один временный WebGL renderer с локальным HDRI Poly Haven Studio Small 03 (Greg Zaal, CC0; источник и SHA-256 в `docs/renderer-decision.md`). Общий PBR-адаптер используется SceneSync и превью. При сбое HDRI применяется нейтральное освещение, при недоступном WebGL показывается явное сообщение; назначение остаётся доступным. Один выбранный primitive/editable Mesh получает материал через атомарную транзакцию ADD_MATERIAL + SET_MATERIAL_SLOT и один Undo-шаг; идентичный пресет повторно не создаётся. GLB с внутренними материалами не назначается до TASK-031, чтобы не заменять несколько слотов молча. Текстур и процедурного рельефа у камня пока нет (TASK-032–034); Drag & Drop и Material Inspector остаются TASK-031. Typecheck, lint, 15 целевых тестов и production build: PASS. Ручной browser smoke: UNVERIFIED — встроенный браузер не открыл локальный Vite URL (timeout). Существующее предупреждение о размере Vite chunk сохраняется.
- **CODEX-031A / TASK-031 / FR-029 (частично):** Карточки пресетов поддерживают нативный Drag & Drop на фактический Mesh под указателем через SurfaceQuery, без смены selection. Общий action назначает материал через одну атомарную транзакцию; кнопка «Назначить», повторное использование материала, Undo/Redo и no-op сохранены. Внутренний MIME принимает только ID из локального реестра и активную RAM drag-сессию с ревизией/эпохой; недопустимые цели и GLB отклоняются с сообщением. Schema/архив не менялись. Typecheck, lint, build и 28 целевых тестов PASS. Браузер открыл WebGPU и WebGL2, но визуальный drag/drop не удалось подтвердить: захват canvas показывал однородный фон и пробный drag не дал наблюдаемого изменения (UNVERIFIED). Material Inspector остаётся отдельной частью TASK-031.
- **CODEX-031B / TASK-031 (реализовано, ручная приёмка не подтверждена):** Правый Inspector показывает действующий доменный PBR-материал, Basic/Advanced-поля, Linear-sRGB и HEX, точные числовые поля, слайдеры и сброс отдельных свойств по однозначному совпадению имени встроенного пресета. Первое изменение общего материала в безопасном режиме создаёт копию с новым ID и переназначает один Mesh атомарно; явный общий режим обновляет все ссылки и запрещён при недоступном связанном объекте. Записи проверяют эпоху, ревизию, выбор, слот, права и полную валидацию; слайдер объединяет Undo, Esc откатывает жест. Transmission автоматически устанавливает opacity=1 с пояснением. Текстуры сохраняются без редактирования и пока не отображаются renderer. Схема/архив не менялись. Typecheck, lint, build и 65 целевых тестов PASS. Ручной desktop smoke и аппаратное сравнение WebGPU/WebGL2 в этом задании не выполнены; визуальный критерий остаётся UNVERIFIED. Сборка сохраняет существующее предупреждение о крупном chunk.
- **CODEX-032A / TASK-032 (частично):** Добавлена проверка и регистрация PNG/JPEG/WebP/HDR/EXR с лимитами 64 МиБ файла и 128 МиБ временного бюджета декодирования. Растры декодируются браузером, HDR/EXR — Three.js; исходные байты и SHA-256 сохраняются в RAM и нативном архиве. ADD_ASSET и EditorStore поддерживают дедупликацию, Undo/Redo, отсечение байтов недоступной ветки истории и проверку актуальности проекта. В библиотеке появились ресурсы и растровые превью с освобождением Blob URL. Typecheck, lint, build и 67 целевых тестов PASS; headless Chrome декодировал PNG/JPEG/WebP, полный ручной UI smoke UNVERIFIED. Назначение PBR-карт и HDRI остаётся следующим этапом. SchemaVersion, formatVersion и manifest не менялись.
