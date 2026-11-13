# TASK-059 — эксперимент Final path tracing

**Решение:** оставить текущий raster Final в редакторе. Path tracing подтверждён на изолированном стенде, но автоматическое включение не принято: холодный запуск превысил бюджет, 32 samples дают заметный шум. Это выполненный эксперимент с ограничениями, а не обещание готового path-traced режима редактора.

## Воспроизведение

В `qa/pathtracer`: `npm ci`, `npm run dev` (localhost:5183), «Рендер 32 samples». `npm run build` проходит. Отдельный lockfile фиксирует Three 0.186.1, three-mesh-bvh 0.9.16 и three-gpu-pathtracer 0.0.27; основной редактор не получает эту зависимость. Версия pathtracer 0.0.28 требует Three >=0.187.0 и BVH >=0.9.17, поэтому она не подменяет проверенный стек проекта.

Сцена: экспортированная golden-сцена хром/стекло/камень (`materials.glb`, 157952 байта) и Studio Small 03 HDR (Greg Zaal / Poly Haven, CC0), общий directional light, камера, HDRI, ACES/exposure 1.25 и плоскость. AmbientLight удалён из итогового сравнительного стенда: pathtracer его не учитывает. GLB уже содержит документированные потери bump/height; этот эксперимент не проверяет их поддержку.

## Наблюдения на текущем окружении

| Запуск | Результат |
|---|---|
| Первый, 400×300 | TIME_BUDGET, 60030 ms, 0 samples; справа виден fallback, не traced image |
| Повторный после исправления стенда | PASS, 32 samples, 5666 ms, isCompiling=false; ошибок консоли нет |
| Отмена повторного запуска | CANCELLED, 1,5 samples, 1491 ms; raster остаётся доступным |

Окружение — тот же desktop/browser, что в `qa/release-verification.md`. Эти измерения не определяют конкретный активный GPU и не доказывают универсальное время запуска. Ускорение повтора согласуется с прогретой компиляцией, но причина отдельно не профилирована. В первом отчёте isCompiling ещё не записывался, поэтому нельзя утверждать, что все 60 секунд ушли именно на shader compilation.

Доказательства: `qa/pathtracer-budget.json`, `qa/pathtracer-comparison.png` (старый стенд с AmbientLight, **не** сравнение traced качества); `qa/pathtracer-warm.json`, `qa/pathtracer-warm.png` (исправленная общая сцена, реальный tracing). На 32 samples видны отражения, преломление и контактные тени, но заметен шум на полу и камне. Сравнение не является pixel-identical acceptance.

Отмена и timeout прекращают накопление и освобождают отдельные tracer/renderer/context, сохраняя raster. Pagehide инвалидирует async-результаты и очищает поздно декодированный GLTF. Компиляция GPU сама по себе не имеет обещанного мгновенного abort; поэтому этот backend остаётся вне основной blocking-job системы редактора.

## Условия будущей интеграции

Нужны отдельный opt-in UI, проверка GPU/backend, профиль cold-start, выбор samples/denoising, сброс накопления при изменении камеры, понятный progress/cancel/fallback и тесты всех поддерживаемых материалов. NodeMaterial/triplanar-проекции и произвольные интеракции этим стендом не подтверждены. Рендер анимации требует детерминированного reset/накопления на каждый кадр.

Источники: [официальный проект](https://github.com/gkjohnson/three-gpu-pathtracer), установленный `src/core/WebGLPathTracer.js` и `PathTracingSceneGenerator.getLights()`, peerDependencies npm 0.0.27/0.0.28. Документация ветки main уже описывает более новый WebGPU-путь; результаты здесь относятся только к зафиксированному WebGLPathTracer 0.0.27.
