# TRIAD-3D

Браузерный редактор 3D для React-проектов. Рабочая версия в разработке: геометрия, материалы, ручное сохранение, освещение, таймлайн и TSX/ZIP-пакет доступны. MVP-приёмка не пройдена.

## Запуск

```sh
npm ci
npm run dev
```

Откройте адрес Vite в настольном Chrome/Edge при ширине окна от 960 CSS px. Проект и история находятся только в RAM. Сохраняйте работу кнопкой «Сохранить проект» в `.triad3d`; после перезагрузки открывайте этот файл вручную.

Доступны примитивы, группы, Boolean/Mirror/Array, ограниченные деформации и редактирование сетки, Displace Brush, PBR-пресеты, material Inspector, импорт изображений и статического GLB, проекции baseColor, Grain/Scratches roughness.

Для освещения импортируйте HDR/EXR через «Библиотека → Ресурсы», затем выберите «Сцена → HDRI». Здесь же редактируются источники света, камера, фон, экспозиция и tone mapping. «Черновик / Качество / Финальный» меняют разрешение растрового предпросмотра; path tracing не включается.

## Проверки

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run export:check
```

`export:check` собирает **прототип** генератора в отдельном React/Vite-проекте. Это не приёмка production TSX-экспорта. `npm test` включает этот стенд; для установки зависимостей стенда нужна сеть.

Для подпути статического сайта задайте `VITE_BASE_PATH` перед сборкой (например, `/triad-3d/`). Публикация и проверка GitHub Pages ещё не завершены.

## Спецификация и готовность

Источник: [Master Project Specification v1.0](docs-people/TRIAD-3D_Master_Project_Specification_v1.0.docx): 76 FR, 18 NFR, 64 задачи, 35 проверок.

- [Аудит и оставшаяся работа](docs/specification-audit.md)
- [Статус реализации](docs/implementation-status.md)
- [Архитектура](docs/architecture.md), [контракты](docs/data-contracts.md)
- [План](docs/implementation-plan.md), [приёмочные сценарии](docs/testing.md)

NEXT выполняется после MVP gate. Сборка не заменяет сквозной сценарий «кольцо → хром → анимация → сохранение → reopen → TSX» и визуальную приёмку.
