# User journeys

## UC-01 Собрать механическое кольцо
Preconditions: Открыт пустой проект
Steps: Добавить torus → настроить размеры → добавить cutter → применить Boolean subtract → создать radial array → назначить материал → сохранить.
Alternatives: CSG ошибочна: rollback и текст ошибки; чрезмерное число копий: подтверждение/отмена.
Refs: FR-012..FR-025, FR-027, FR-010

## UC-02 Создать хром со следами обработки
Preconditions: Выбран mesh, есть HDRI
Steps: Галерея «Металлы» → «Хром» → metalness/roughness → процедурные scratches → intensity scale → предпросмотр Final → сохранение.
Alternatives: Нет HDRI: нейтральное окружение и подсказка; карта повреждена: отменить только карту.
Refs: FR-027..FR-037

## UC-03 Анимировать деталь по двум точкам
Preconditions: Доступна модель
Steps: Установить старт key → переместить playhead к концу → перетащить деталь → установить end key → выбрать easing → установить loop → preview.
Alternatives: Концы несовместимы: «Сгладить цикл» или предупреждение; track locked: блокировать.
Refs: FR-040..FR-048

## UC-04 Скомбинировать spin и магнит
Preconditions: Есть базовая циклическая анимация
Steps: Добавить interaction «Magnet proximity» → настроить радиус/falloff/priority → отвести курсор → убедиться, что базовая фаза не потеряна.
Alternatives: Конфликт каналов: показать priority/blend вариант.
Refs: FR-049..FR-052 NEXT

## UC-05 Сцена с копиями модели
Preconditions: Есть исходная модель
Steps: Scene → добавить linked instances → настроить свет/камеры → изменить исходную модель → просмотреть diff → Sync по кнопке.
Alternatives: Отдельная копия override материала: сохранить override при sync.
Refs: FR-056..FR-058 NEXT

## UC-06 Перенести модель на сайт
Preconditions: Есть модель, материалы и анимация
Steps: Export → React TSX → quality balanced → props → preview → ZIP → чистый React/Vite проект → build → просмотр.
Alternatives: Не поддержан эффект: явно указать; переключение Quality не меняет исходник.
Refs: FR-069..FR-075

## UC-07 Ручное сохранение и возобновление
Preconditions: Открыт проект
Steps: Save project → получить *.triad3d → закрыть вкладку → открыть сайт → Import Project → выбрать архив → продолжить.
Alternatives: Повреждён manifest: не портить текущую сессию.
Refs: FR-008..FR-011

## UC-08 Импортировать исходник TSX
Preconditions: Открыт редактор
Steps: Import code → AST analysis → report supported/unsupported → принять частичный импорт.
Alternatives: Никаких dynamic imports/eval/network; неизвестное не исполнять.
Refs: FR-066..FR-067 NEXT

## UC-09 Отменить тяжёлый пересчёт
Preconditions: Есть сложная модель
Steps: Применить boolean/array → busy overlay → Cancel → проверка исходного состояния → продолжить редактирование.
Alternatives: Worker crash: rollback, clean temp geometry.
Refs: FR-065, NFR-003..NFR-006
