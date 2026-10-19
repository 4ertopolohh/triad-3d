# TASK-002 — WebGPU/WebGL2 и PBR

Дата проверки: 19 октября 2026. Статус spike: **COMPLETED** для двух доступных backend в одном браузерном окружении. **ADR-004 остаётся PROPOSED** до межбраузерной и аппаратной проверки.

## Воспроизведение

```text
npm ci
npm run dev
http://127.0.0.1:5173/?spike=renderer
```

Если порт занят, используйте адрес, напечатанный Vite. Режим доступен только в dev-сборке; обычный экран редактора открывается без query-параметра. Выберите оба режима по очереди, дождитесь статуса «Готово» и «HDRI: Загружен», затем нажмите «Сбросить вид». Сравнивайте при одинаковом размере окна. Контрольные снимки 1280×800: [WebGPU](renderer-snapshots/webgpu.jpg) и [WebGL2](renderer-snapshots/webgl2.jpg). На каждом снимке виден фактический backend.

## Среда и версии

| Параметр | Наблюдение |
| --- | --- |
| Three.js / `@types/three` | 0.186.1 / 0.186.0, зафиксированы в lockfile |
| TypeScript | 5.9.3 |
| ОС | Windows 11 Home, build 26300 |
| Установленные GPU | NVIDIA GeForce GTX 1050 with Max-Q Design, Intel UHD Graphics 620; какой адаптер выбрал браузер, не определено |
| Браузер испытания | Встроенный Chromium браузер Codex; точная версия не предоставлена инструментом |
| Chrome / Edge | В этом испытании не использовались; версии и результаты `UNVERIFIED` |
| Размер | viewport 1280×800 CSS px, canvas 1215×534 CSS px; устройство с DPR браузера |

## Матрица совместимости

`PASS` означает наблюдаемый результат в указанной среде; `UNVERIFIED` — отсутствие испытания, а не положительный результат.

| Проверка | Auto / WebGPU preferred | Forced WebGL2 |
| --- | --- | --- |
| `renderer.init()` и кадр | PASS — фактически WebGPU | PASS — фактически WebGL2 |
| Хром, отражения | PASS — яркие отражения HDRI видны на сфере | PASS — отражения видны |
| Стекло, transmission / IOR | PASS — полосы позади сферы видны сквозь неё, отражения сохранены | PASS — тот же эффект виден |
| Normal map | PASS — периодический рельеф заметен при направленном свете | PASS — рельеф заметен |
| Локальный HDRI | PASS — загружен и виден в фоне и отражениях | PASS — загружен и виден |
| Повторное переключение, один canvas | PASS | PASS |
| Reset View | PASS — после вращения восстановлена фиксированная камера | NOT_APPLICABLE — отдельно не повторялось в этой ветке, код общий |
| Автоматический fallback при отсутствии WebGPU | UNVERIFIED — WebGPU здесь доступен | NOT_APPLICABLE |
| Отсутствие WebGL2 / ошибка GPU-инициализации | UNVERIFIED | UNVERIFIED |
| Ошибка загрузки HDRI | UNVERIFIED — обработчик реализован, ресурс не повреждался для испытания | UNVERIFIED |
| Другие браузеры и GPU | UNVERIFIED | UNVERIFIED |

После перехода по ссылке «Вернуться в редактор» обычная страница показана без canvas. В консоли при первичной проверке обнаружено предупреждение об устаревшем `RGBELoader`; прототип переведён на `HDRLoader` и повторно проверен. Других ошибок и явных различий между снимками не выявлено. Снимки демонстрируют базовую работоспособность, но не являются пиксельным или колориметрическим сравнением. Для Studio Small 03 характерен большой перепад яркости: фон, подставка и стекло местами очень светлые; для будущих пресетов следует отдельно калибровать экспозицию.

## Эталонная сцена и pipeline

Оба режима создают сцену одной фабрикой. Сферы имеют одинаковую геометрию с UV и нормалями. Хром: `MeshPhysicalMaterial`, metalness 1, roughness 0.08. Стекло: transmission 1, IOR 1.5, thickness 1.4, opacity 1. Normal map детерминированно генерируется в canvas, помечена `NoColorSpace` и накладывается на UV-сферу. Общие камера, свет, HDRI, ACES Filmic tone mapping, exposure 1.25 и выходной `SRGBColorSpace` заданы независимо от backend. HDRI загружается как radiance data через `HDRLoader` и используется с `EquirectangularReflectionMapping`; Three.js выполняет необходимую обработку environment для PBR. При ошибке HDRI сцена остаётся с нейтральным освещением, а статус становится `FAILED`.

HDRI: [Poly Haven — Studio Small 03](https://polyhaven.com/a/studio_small_03), автор Greg Zaal, 1K `.hdr`, 1 686 299 байт, SHA-256 `30933D55E45F0795DAF49F3CBEFBE0E5EBCB821EE04FB0A2818C02FFC3938817`. [Лицензия CC0](https://polyhaven.com/license). Файл хранится локально в `src/spikes/renderer/assets/` и включается только в dev-режим; сетевое соединение при запуске сцены не требуется.

## Решение и ограничения

Для TASK-014 рекомендован единый `WebGPURenderer` с предпочтением WebGPU и его WebGL2 fallback, а также явный `forceWebGL` для диагностики и тестов. Показывать backend следует по `renderer.backend` **после** `await renderer.init()`, не по `navigator.gpu` и не по `isWebGPURenderer`, который обозначает класс renderer. При невозможности инициализации — ошибка и ручной повторный запуск, без бесконечных попыток. Владение canvas, loop, controls, textures, materials и geometries должно быть ограничено жизненным циклом adapter; TASK-014 отдельно реализует context-loss recovery и синхронизацию из утверждённого доменного состояния.

Для TASK-029 следует зафиксировать поддерживаемую PBR-схему и цветовые пространства: normal map — данные, цветовые текстуры — sRGB, HDR environment — линейный радианс. Перед production нужны visual golden для металла и стекла на разных устройствах. Для TASK-036 профили качества должны иметь измеренную матрицу возможностей каждого backend и явные предупреждения о деградации. FPS и бюджет памяти в этом spike не измерялись.

По [руководству Three.js](https://threejs.org/manual/pages/webgpurenderer) `WebGPURenderer` остаётся экспериментальным; классические `ShaderMaterial`, `RawShaderMaterial`, `onBeforeCompile()` и старый `EffectComposer` не поддерживаются этим renderer. Пользовательские эффекты для него потребуют node materials / TSL и отдельной проверки обеих веток. Это ограничение документации, **не результат запуска таких эффектов в данном spike**. [API `WebGPURenderer`](https://threejs.org/docs/pages/WebGPURenderer.html) подтверждает `forceWebGL`; [API `MeshPhysicalMaterial`](https://threejs.org/docs/pages/MeshPhysicalMaterial.html) подтверждает требование `opacity: 1` при ненулевом transmission.

Двух успешных запусков в одном браузере недостаточно для окончательного выбора production backend. До принятия ADR-004 нужны Chrome и Edge с зафиксированными версиями и фактически выбранным GPU, испытание отсутствия WebGPU/WebGL2, HDRI decode failure, context loss, серия переключений под профилировщиком, сравнение качества/производительности и тест будущих материалов и postprocessing. Пока стратегия — предпочтение WebGPU с наблюдаемым WebGL2 fallback, без заявления о полной эквивалентности.
