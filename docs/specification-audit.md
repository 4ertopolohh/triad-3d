# Аудит спецификации TRIAD-3D v1.0

Дата: 13 ноября 2026. Исходная точка: `9f0286f` (CODEX-034B). Источник: `docs-people/TRIAD-3D_Master_Project_Specification_v1.0.docx`, сопоставленный с требованиями, планом, контрактами, тестами и кодом. Это анализ готовности, а не акт завершения проекта.

**Definition of Done из раздела 2.5 не выполнен.** Редактор геометрии и материалов существует, но таймлайн и полноценный TSX/ZIP-экспорт отсутствуют. Успешный экспортный harness проверяет только spike с кубами. Старый README ошибочно называл репозиторий документацией без реализации; он исправлен.

## Состояние всех этапов

| Задачи | Доказательства в репозитории | Оставшаяся работа |
| --- | --- | --- |
| TASK-001–005 | Domain, renderer/CSG/TSX spikes, токены и отчёты | Spikes не доказывают production-полноту; ограничения перенести в release matrix |
| TASK-006–013 | Vite/React, команды, RAM store/history, миграции, ZIP, shell | Полный ручной save/close/reopen; GLB ограничен статическим subset |
| TASK-014–019 | SceneSync, adapter, gizmo/picking, примитивы, дерево, Inspector, BVH | Аппаратная приёмка всех инструментов и больших сцен |
| TASK-020–023 | CSG worker, evaluator, Boolean, Array/Mirror, проверки кандидата | CSG теряет UV/material groups; последующая трансформация cutter требует проверки rollback вычисленного результата |
| TASK-024–025 | Vertex/edge/face, translate/scale, planar extrude, деформации и тесты | Приёмка ограниченной топологии; Bevel допускает только выпуклые solids, не произвольную сетку |
| TASK-026 | Displace Brush, осевая симметрия | Paint/Material Brush, fill и полный shape/stencil |
| TASK-027–028 | JobController, отмена, mesh validation | Проверка каждого нового тяжёлого пути; не доказано отсутствие всех self-intersections |
| TASK-029–033 | PBR, пресеты, Inspector, импорт изображений/HDR/EXR, четыре baseColor-проекции | Normal/bump и остальные PBR-каналы, полная visual QA |
| TASK-034 | Grain/Scratches roughness подключены; Stone height только в генераторе | Height/bump, остальные фактуры, baking/export |
| TASK-035 | В этой итерации: scene-команды/UI, свет/HDRI/камера, worker decode, exposure/tone mapping, схема 1.7 | Сравнительные chrome/glass/stone golden-сцены на целевом GPU |
| TASK-036 | В этой итерации: три профиля разрешения raster preview | Дополнительные эффекты и path tracing не включаются; полная capability/quality приёмка открыта |
| TASK-037–043 | Базовые типы Clip/Track/Keyframe и fixtures | Timeline validation/commands/evaluator/UI, запись ключей, Bezier, presets/pivot, loop analyzer |
| TASK-044–047 | Только `src/spikes/export/generate-tsx.ts`; кнопка экспорта editor отключена | Production generator, geometry/material/assets/animation, ZIP, props, profiles, wizard |
| TASK-048–049 | Vite допускает подпуть | Полный MVP E2E, статическая публикация и deployed smoke |
| TASK-050–060 | Некоторые типы заложены; production-модули NEXT отсутствуют | Instances/sync, layers/DSL/physics, AST import, stamps, GLB/video, packs, path tracer spike, optimization — после MVP gate |
| TASK-061–064 | Есть отдельные negative tests и spike-отчёты | Полная golden/security/performance/fresh-clone приёмка и release matrix |

«Код присутствует» не означает полного соответствия каждому FR/NFR. Исторический статус описывает отдельные итерации и местами устарел: extrude реализован после записей CODEX-024C/D.

## Проблемы плана и реализации

1. Главный пользовательский путь обрывается перед анимацией и экспортом. TASK-038/039/044–048 обязательны до заявления о готовности MVP.
2. План содержит обратные зависимости: TASK-062 (MVP) зависит от TASK-054/056 (NEXT), TASK-063 (MVP) — от TASK-060 (NEXT), хотя NEXT запрещён до MVP gate. Утверждённый план не изменён. Нужна отдельная MVP-проверка существующих импортов/архивов и базовой производительности, затем расширенная приёмка после NEXT. Полные TASK-062/063 пока закрывать нельзя.
3. Manifoldness и отсутствие degenerate triangles не доказывают отсутствие любых самопересечений. Потеря UV после CSG влияет на кисти, процедурные материалы и экспорт.
4. Старые отметки UNVERIFIED не превращены в PASS. В этой итерации проверены конкретные сценарии освещения и компоновки; полная визуальная матрица и ручной save/reopen остаются открытыми.
5. В Git отслеживаются cache-файлы внутри `node_modules`, несмотря на `.gitignore`. Их изменения от тестов не входят в коммит этой итерации.

## Реализовано и проверено в этой итерации

`SET_SCENE_SETTINGS` валидирует настройки/ID и сохраняет сцену одной обратимой транзакцией. Документ 1.7 добавляет необязательные параметры окружения и renderSettings. Старые документы мигрируют без добавления новых значений; ZIP остаётся 1.0. Новые назначения HDRI принимают HDR/EXR; исторические ссылки иных типов сохраняются с диагностикой при отображении.

HDRI декодируется в Worker с существующим бюджетом изображений. Смена проекта/окружения завершает Worker; поздние результаты освобождаются. Направление строк пикселей сохраняется. Ошибка включает нейтральный свет, исходные байты не меняются.

Исправлена высота workspace: длинные панели прокручиваются внутри окна и не уводят центр canvas ниже экрана. До исправления браузер показал canvas высотой 1859 px при окне около 720 px; после исправления сфера видна без прокрутки страницы.

До изменений: 52 файла / 380 тестов PASS с чистым Vite/React spike harness. Добавлены command rollback/no-op/Undo/Redo, migration/archive round-trip, реальные HDR/EXR decoder responses, cancel/late completion/dispose/fallback и проверка профилей/exposure. Итоговые результаты записаны в `implementation-status.md` после проверок.

Browser smoke: сфера → хром → импорт Studio Small 03 HDR → назначение → поворот 90°; exposure 2 и Undo/Redo; WebGL2/WebGPU; Draft/Final; прокрутка Inspector. Отражения видимы в обоих backend; в доступном console error log ошибок нет. Проверены desktop 1440×900 и узкий guard; временный viewport override сброшен. Это smoke, а не golden-приёмка.

## Последовательность завершения

Геометрия и кисти → PBR normal/bump/процедуры и lighting golden → TASK-037–043 → TASK-044–047 → TASK-048/049 → MVP security/performance/visual gate → NEXT TASK-050–060 → полная release-приёмка TASK-061–064. Заглушки и массовые отметки DONE не заменяют эти этапы.
