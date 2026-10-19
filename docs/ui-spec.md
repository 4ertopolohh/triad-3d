# UI screens and modules

Desktop only; no mobile authoring. Base reference: Triad Studio Actay/AKONY + #F2F2F2 / #303030 / #7497DC; licensing verify.

## UI-01 Главное рабочее пространство
Location: /
Layout: Топбар: проект, режим, Undo/Redo, save/export; левый dock: дерево/пресеты; центр: viewport; справа Inspector; снизу collapsible timeline.
Actions: New, import, select, transform, start jobs, export.
States: empty / dirty / busy / loading / feature fallback / error
Interaction/accessibility: Режим desktop, resize docks, escape dialogs, keyboard focus, shortcuts.

## UI-02 Редактор модели
Location: внутри /
Layout: Toolbar: select/move/rotate/scale, vertex/face, boolean, array, mirror, brushes; world grid, gizmo, snapping.
Actions: Создать примитив, менять mesh, stack modifiers, preview brush.
States: invalid mesh / unsupported topology / pending calculation
Interaction/accessibility: Hover help; action disabled with reason; no destructive silent actions.

## UI-03 Редактор сцены
Location: внутри /
Layout: Scene tree, model instance(s), lights, cameras, background/HDRI; own viewport.
Actions: Перенос копий, настройка окружения, подготовка финального кадра.
States: missing environment / stale instance revision
Interaction/accessibility: Linked instance & overrides visible, explicit sync action.

## UI-04 Дерево объектов
Location: dock left
Layout: Вкладки «Объекты», «Библиотека»; контекстные операции, hide/lock, drag/reparent.
Actions: Select, multi-select, group/ungroup, rename, hide/lock.
States: zero objects / huge hierarchy / mixed lock flags
Interaction/accessibility: Virtualize long lists, preserve IDs, prohibit cycles.

## UI-05 Инспектор параметров
Location: dock right
Layout: Basic sections per selection, advanced in accordion; numeric inputs, reset, material slots, links to modifiers.
Actions: Edit transforms, materials, geometry, animation, brush settings.
States: no selection / mixed values / invalid number
Interaction/accessibility: Immediate preview except explicitly expensive actions; debounce safe.

## UI-06 Библиотека материалов и деталей
Location: dock left tab
Layout: Search, categories, thumbnails, three-dimensional material preview, drag-to-apply, favorites in memory.
Actions: Выбрать preset, inspect properties, import pack, save pack.
States: assets loading / download failure / unsupported texture
Interaction/accessibility: Fonts/theme align reference; asset licensing disclosure.

## UI-07 Редактор модификаторов
Location: inspector tab
Layout: Ordered operation stack with enabled/drag reorder, parameters, preview, warnings.
Actions: Добавить, изменить, отключить, перетащить, удалить modifier.
States: CSG failure / non-manifold mesh / expensive recompute
Interaction/accessibility: Atomic apply, batch compute with cancellation boundary.

## UI-08 Кисти и поверхность
Location: viewport overlay
Layout: Toolbar brush type/shape, radius, intensity, fill, symmetry; on-surface cursor decal and optional gizmo.
Actions: Stroke begin/continue/commit/cancel, stamp preview.
States: no hit / no UV / locked object / too large region
Interaction/accessibility: One stroke = one undo command; preview disappears on cancel.

## UI-09 Таймлайн и Graph Editor
Location: dock bottom
Layout: Tracks/keys, playback, loop region, easing editor, slow-motion rates, time ruler.
Actions: Set keyframes, drag/stretch, edit tangent/curve, preview.
States: empty animation / channel conflicts / non-seamless loop
Interaction/accessibility: Separate animation time from wall clock; keyboard seek.

## UI-10 Конструктор интерактивности
Location: panel/modal
Layout: Preset gallery and typed Event → Condition → Action blocks with priority and blend mode.
Actions: Create rules, pick targets, preview cursor interactions.
States: dependency cycle / incompatible action / unsupported export
Interaction/accessibility: No code eval; only approved typed nodes. NEXT.

## UI-11 Диалоги импорта
Location: modal
Layout: Drop/file picker, validation, compatibility report, preview tree of recognized items.
Actions: Import TRIAD3D, GLB, future code import, confirm partial mapping.
States: corrupt/unsupported/oversized/untrusted
Interaction/accessibility: User confirms before replacing current document.

## UI-12 Экспорт и предпросмотр
Location: modal
Layout: Format selector TSX/ZIP/GLB/video; quality profile; props; dependencies; warnings; export preview.
Actions: Copy TSX or download ZIP; compare optimization stats.
States: code compile failure / unsupported property / canceled export
Interaction/accessibility: Never mutate source project; show exact omission list.

## UI-13 Долгая операция
Location: modal overlay
Layout: Modal lock, action name, spinner/bar, steps, Cancel if supported.
Actions: Wait, cancel, inspect result; block edit throughout.
States: unknown progress / worker terminated / out of memory
Interaction/accessibility: Restore previous valid state and unlock in finally.

## UI-14 Подсказки и справка
Location: popover
Layout: Tooltip on hover; complex controls include short inline silent motion demonstration; shortcut reference.
Actions: Open help, replay demonstration, quick explanation.
States: reduced motion / no preview resource
Interaction/accessibility: Russian copy, easy dismiss, no blocking on use.


## Action matrix

- UI-01 **Новый проект** — Щелчок в topbar; DIRTY — confirm; result: Создать один Model и Scene; сбросить временный selection.; refs: FR-001;FR-003
- UI-01 **Модель / Сцена** — Выбор вкладки, не busy; result: Переключить редактор, сохранив domain graph.; refs: FR-002
- UI-01 **Сохранить проект** — Ctrl+S или topbar, проект загружен; result: Сформировать .triad3d и предложить ручную загрузку на диск.; refs: FR-010
- UI-01 **Отменить / Повторить** — Активна история, не busy; result: Применить обратимую команду без изменения уже сохранённого файла.; refs: FR-009
- UI-01 **Экспорт** — Команда Export, документ валиден; result: Открыть UI-12; не очищать DIRTY.; refs: FR-068;FR-073
- UI-02 **Добавить фигуру** — Выбор primitive; result: Создать параметрический Node и поместить в дерево.; refs: FR-012
- UI-02 **Переместить / Вращать / Масштабировать** — Узел выделен и не locked; result: Gizmo и numeric fields создают Command; undo один drag.; refs: FR-004
- UI-02 **Редактировать вершины/грани** — Подходящая геометрия и mesh mode; result: Войти в sub-selection, применить допустимую топологическую операцию.; refs: FR-013
- UI-02 **Создать отверстие** — Выбран замкнутый mesh и cutter; result: Добавить Boolean modifier, validate, compute, commit.; refs: FR-014
- UI-02 **Симметрия / Массив** — Существующий объект; result: Добавить Mirror/Array modifier, параметры в UI-07.; refs: FR-016;FR-017
- UI-04 **Скрыть / Заблокировать** — Выбран узел; result: Обновить visible/locked flag без удаления.; refs: FR-007
- UI-04 **Группировать / Разгруппировать** — Несколько выбранных узлов; result: Создать/убрать parent с сохранением мировой позиции.; refs: FR-005
- UI-05 **Сбросить свойство** — Редактируемое свойство; result: Вернуть preset/default через Command.; refs: FR-030
- UI-06 **Применить материал** — Выбран mesh/slot, preset загружен; result: Сменить materialId, показать видимое изменение.; refs: FR-029
- UI-06 **Загрузить текстуру** — Файл выбран; result: Decode+validate+asset add; error не меняет document.; refs: FR-031
- UI-07 **Отключить модификатор** — Modifier существует; result: enabled=false и recalculation через cache invalidation.; refs: FR-019
- UI-07 **Поменять порядок** — ≥2 modifiers; не busy; result: Reorder и проверка топологии; rollback при ошибке.; refs: FR-019
- UI-08 **Кисть: радиус / сила / форма** — Активна кисть; result: Изменить preview курсора, не менять модель до stroke.; refs: FR-021
- UI-08 **Заливка / Симметрия** — Меш поддерживается; result: Операция кисти применяет shape/area/symmetry mask.; refs: FR-021
- UI-09 **Добавить ключевой кадр** — Трек/время/объект выбраны; result: Записать значение в absolute t.; refs: FR-040
- UI-09 **Играть / Пауза** — Анимация существует; result: Playback по deterministic timeline evaluator.; refs: FR-042
- UI-09 **Сгладить цикл** — Есть loop region; result: Align end pose/tangents либо предупреждение.; refs: FR-044
- UI-09 **Кривая плавности** — Выбран keyframe interval; result: Правка Bezier и обновление preview.; refs: FR-043
- UI-10 **Добавить условие/действие** — NEXT; typed event graph; result: Создать allowlisted rule без исполнения кода.; refs: FR-050
- UI-11 **Открыть файл** — File picker или drag-drop; result: Проверить сигнатуру/схему, показать dry-run report.; refs: FR-011;FR-064
- UI-11 **Применить импорт** — Успешная валидация и confirm если DIRTY; result: Commit импортированную модель/проект транзакционно.; refs: FR-011
- UI-12 **Режим качества** — Export settings доступны; result: Построить отдельный derived export preview без изменения исходника.; refs: FR-073
- UI-12 **Скопировать TSX** — Компонент без неупакованных внешних ассетов; result: Поместить код в clipboard и показать зависимости.; refs: FR-069
- UI-12 **Скачать ZIP** — Export pipeline успешен; result: Создать TSX/assets/README с относительными путями.; refs: FR-070
- UI-13 **Отмена вычисления** — Job supports abort; result: Отменить на safe boundary, rollback и разблокировка.; refs: FR-063
- UI-14 **Демо подсказки** — Hover/focus на сложном инструменте; result: Показать краткую анимацию и инструкцию на русском.; refs: FR-059