# Architecture

Decision: client-only modular SPA, domain graph / commands are source of truth; renderer is derived.

## Components

- `domain`: schema, validators, commands, history
- `renderer`: Three.js adapter + GPU fallback + resource disposal
- `geometry`: WASM CSG, BVH, procedural modifiers, workers
- `materials`: PBR schema and texture generators
- `animation`: deterministic t→pose tracks, layer/event extension
- `assets`: in-memory bytes and hashes, import/archive
- `exporters`: templates for TSX/ZIP, GLB and video later
- `ui`: Russian desktop panels and tool states

## Domain flow

UI event → typed command → validate → worker evaluate (optional) → commit patch once → renderer/cache sync → reversible history. Any error/cancel → rollback.

## Heavy operation states

IDLE → VALIDATING → RUNNING → APPLYING → SUCCEEDED; error/cancel terminal states never mutate Project. Block editing; allow progress/cancel.

## ADRs

### ADR-001 Веб SPA без обязательного backend (ACCEPTED)
Why: Личный desktop инструмент; статический деплой; локальная работа с файлами.
Decision: React/Vite + client-only computational core; возможность отдельной службы лишь при подтверждённой необходимости.
Consequences: Ограничение браузерной памяти/кодеков; без серверной обработки и аккаунтов.
Alternatives: Electron/desktop shell, Django backend.

### ADR-002 Независимая доменная модель (ACCEPTED)
Why: Сложные rollback, import/export и модификаторы не должны зависеть от React-компонентов.
Decision: Версионируемый document graph, commands, derived cache; UI рендерится поверх ядра.
Consequences: Понадобятся явные adapters и type contracts.
Alternatives: Хранить Three.Object3D как единственный источник истины.

### ADR-003 CSG через Manifold/WASM (спайк) (PROPOSED)
Why: Нужны устойчивые операции solid mesh Boolean без разрушения исходных параметров.
Decision: Manifold для manifold inputs, fallback/report и geometric validation.
Consequences: Сложные non-manifold mesh требуют отдельной обработки.
Alternatives: three-bvh-csg, собственный CSG.

### ADR-004 Renderer abstraction (PROPOSED)
Why: WebGPU приоритетен, но несовместимости материалов/постобработки возможны.
Decision: RendererAdapter с WebGPU experimental path, проверяемым WebGL2 fallback, feature flags.
Consequences: Нельзя считать все эффекты идентичными в обоих backend.
Alternatives: Жёстко привязать всё к WebGPU или WebGL.

### ADR-005 RAM-only project lifecycle (ACCEPTED)
Why: Пользователь запретил восстановление после закрытия вкладки.
Decision: Document/cache/history — memory; только явный файл на диске.
Consequences: Потеря несохранённых данных при refresh/crash.
Alternatives: IndexedDB autosave.

### ADR-006 Отдельные нативный проект и export (ACCEPTED)
Why: glTF не передаёт произвольную бизнес-логику/interactive runtime; React экспорт требует код.
Decision: TRIAD3D ZIP + TSX runtime package + GLB variants; матрица потерь.
Consequences: Два кодовых пути необходимо синхронно тестировать.
Alternatives: Считать GLB полным проектом.

### ADR-007 Безопасный синтаксический импорт (ACCEPTED)
Why: Произвольный TSX/HTML не может быть универсально конвертирован и небезопасен при исполнении.
Decision: AST allowlist, partial import report; unknown code never executed.
Consequences: Сложный исходный код будет частично импортирован или отклонён.
Alternatives: Eval во iframe/sandbox c широкими правами.

### ADR-008 Редактируемый стек модификаторов (ACCEPTED)
Why: Нужна поздняя настройка отверстий и симметричных массивов.
Decision: Modifier params + deterministic evaluate pipeline + cache invalidation.
Consequences: Нужно управлять зависимостями и вычислительной сложностью.
Alternatives: Bake each change destructively.

### ADR-009 Animation tracks + interactions (ACCEPTED)
Why: Взаимодействие с курсором не должно сбрасывать цикл вращения.
Decision: Base deterministic timeline, затем layered interaction offsets/constraints, priority and blend.
Consequences: Dynamic collisions могут изменить цикл; нужны диагностика и проверка.
Alternatives: Один imperative requestAnimationFrame handler на объект.

### ADR-010 Один Model + одна Scene (ACCEPTED)
Why: Для личного сценария несколько корневых моделей и сцен усложняют UX.
Decision: Корни model + scene, nested geometry groups, linked instances.
Consequences: Некоторые production сценарии потребуют явных копий/новых файлов.
Alternatives: Несколько независимых проектов в одном документе.

### ADR-011 Блокировать редактирование на тяжёлых jobs (ACCEPTED)
Why: Пользователь хочет выделять ресурсы текущей операции.
Decision: Computation Worker + job state + modal overlay + rollback/cancel.
Consequences: Запрет параллельного редактирования; в progress UI остаётся responsive.
Alternatives: Параллельные edit jobs.

### ADR-012 Профили качества и честная деградация (ACCEPTED)
Why: Высокое качество preview и экспорт для обычного сайта конфликтуют по бюджету.
Decision: Draft/Quality/Final для редактора, Max/Balanced/Lite для экспорта.
Consequences: Визуальная эквивалентность не обещается для всех эффектов.
Alternatives: Единый quality toggle для всего.
