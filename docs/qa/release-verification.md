# Release verification — 13 November 2026

Candidate: `53aa6c4` plus the release QA changes. This is an evidence log, not a declaration that all NEXT tasks are complete.

## Reproducible inputs

`tests/release/golden-fixtures.test.ts` creates native archives and export ZIPs for chrome/glass/stone spheres and a chrome torus with a two-second spin. Set `TRIAD_QA_DIR` to retain these artifacts. Cameras, positions, lighting, procedural seeds and animation keys are fixed in that fixture. Native roundtrip and export generation are checked in the ordinary test suite.

## Browser observations

Windows, Codex in-app Chromium browser, 1280×720 CSS viewport. The exact embedded browser version and active GPU adapter were not exposed by the inspected UI and are not asserted here. Installed adapters: NVIDIA GeForce GTX 1050 with Max-Q (driver 32.0.15.8278), Intel UHD 620 (31.0.101.2140). Three.js 0.186.1. Screenshots are manually inspected smoke evidence, not pixel-diff goldens or human approval.

- `materials-webgpu.png`, `materials-webgl2.png`: fixed sphere scene, displayed backend verified in the editor. Chrome reflections, transparent glass and stone appear in both; error console empty.
- `stone-procedural.png`, `stone-baked.png`: selected stone, height strength 10, seed 7, scale 8, intensity 0.8. Height PNG downloaded, imported through the resource library and assigned with bump strength 10. Visually matching relief after aligning procedural filtering/mipmaps with raster textures. Camera and lighting unchanged between these two captures.
- `production-ring.png`: isolated fresh clone, `npm ci`, build with `/triad-3d/`, Vite production preview at that subpath. Native ring archive opens with HDRI and timeline; error console empty. Reload returns an empty new project and disabled Undo, confirming no automatic restoration in this scenario.
- Previous ring flow: editor save/reopen and downloaded production ZIP were exercised; the downloaded ZIP installed and built in an independent temporary directory.

## CPU baseline

`tests/release/performance-baseline.test.ts`, Windows 10.0.26300, Node 24.21.0, Intel i7-8550U @ 1.80 GHz, 8 logical CPUs, 16 GB RAM. Single measured run: 100 spheres / 96,000 triangles; validation 12.81 ms, export 1,641.33 ms, Stone 512² generation 101.26 ms. Export 7,814,343 bytes. Process RSS 119,758,848 → 165,486,592 bytes. No forced GC; memory includes the test runner. These values are not browser FPS, GPU memory measurements or statistical performance guarantees.

## Browser render baseline

`qa/performance.html` is a development-only diagnostic entry. Same machine, Chrome/157.0.0.0 embedded browser, DPR 1.25, Final profile, drawing buffer 1000×562. 100 spheres, 30 warmup frames and 120 measured frames. WebGPU CPU submission mean/p95: 8.72/13.80 ms; WebGL2: 7.35/10.70 ms. Frame intervals mean/p95: 17.05/21.90 ms and 16.67/25.90 ms respectively. Renderer-accounted resource totals: 9,281,620 and 8,705,314 bytes. Detailed snapshots: `performance-webgpu.json`, `performance-webgl2.json`. Background browser scheduling and concurrent local processes affect these single runs. No GPU completion timing, total VRAM or performance guarantee is inferred. The active hardware adapter remains unidentified.

## Security and lifecycle coverage

Native archive tests cover malformed archives, path traversal, size limits, hashes and schema rejection; GLB tests enforce static subset and reject external resources. Renderer tests cover stale asynchronous completions and resource disposal. Project/history/asset bytes remain in RAM; source search found no localStorage or IndexedDB usage. The manual reload observation supplements these tests but does not prove every browser lifecycle path.

## Remaining release gates

Public deployed smoke passed for candidate `9f8117e`: https://4ertopolohh.github.io/triad-3d/ . Opened ring archive with HDRI, WebGPU and playback; console error log empty. Proof: `pages-ring.png`. CI on Windows and Ubuntu and Pages workflow passed (runs 43324886511 and 43324924038).

Exact active-GPU attribution, geometry performance profile and remaining NEXT tasks are still required. TASK-062/063 need extension to NEXT import/export/optimization paths after those exist. Do not mark those tasks complete using these baselines alone.
