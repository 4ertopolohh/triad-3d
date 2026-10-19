# TASK-004 — TSX export feasibility

Status: **COMPLETED** for the spike only. This does not implement FR-068–071 or TASK-044.

## Verified setup and pipeline

- Windows, Node 24.21.0, npm 11.19.0; React/React DOM 19.3.1, Three.js 0.186.1, TypeScript 5.9.3, Vite 8.3.4.
- Input: `createNestedMeshProject()` (root → nested group → cube) and `createMaterialAnimationProject()` (same graph, chrome PBR material, animation track).
- `generateSpikeTsx(Project)` validates the domain graph, converts supported fields to JSON literals, and returns TSX, package dependencies and diagnostics. It does not mutate the project.
- `npm run export:check` creates a temporary directory outside the repository, copies only `harness/tsx-export`, writes automatically generated TSX through Vitest, runs `npm ci`, `tsc --noEmit`, and `vite build`, then checks `dist/index.html`. The harness has its own package and lockfile. No editor source is present in its build directory.

## Results

- `npm exec vitest run tests/export/generate-tsx.test.ts`: 7 tests passed, including the isolated TypeScript/Vite build.
- `npm exec vitest run tests/domain/project.test.ts`: 9 tests passed.
- `npm run typecheck`, `npm run lint`, `npm run build`: passed.
- Browser smoke: **PASS** in the Codex in-app browser with WebGL. A cube silhouette was visible, the browser reported no errors, and exactly one canvas existed after React StrictMode mount. Changing the `width` prop from 640 to 400 in the temporary harness updated the canvas width; it remained one canvas. A [control screenshot](tsx-export-smoke.png) was captured during the check.

## Supported fields and policy

The spike supports cube `size` or `width`/`height`/`depth`, node hierarchy and local position/quaternion/scale, visibility, names/IDs, one assigned PBR material per mesh, scene camera, background color, and ambient/directional/point/spot lights. Generated TSX uses React lifecycle cleanup for Three resources and canvas. User strings are serialized and escaped; no source fields are executed as code.

Invalid domain structures and unsupported geometry, modifiers, extra material slots or scene instances fail with typed `SpikeExportError`. Animation, textures/assets, HDRI and nondefault environment/background intensity receive explicit omission diagnostics while the static model is exported. No animation runtime, CSG, imported mesh, ZIP, GLB, procedural texture, interaction, quality profile or video is implemented.

## TASK-044 implications

The isolated build establishes that the basic generated component has no editor runtime dependency. It does not prove all future export cases. A fully metallic material renders nearly black without an environment map; TASK-044 needs environment packaging or a documented material preview policy. The current generator is intentionally a narrow spike, with static render and no resize observer or context loss handling. Production export also needs coverage for assets, modifiers and animation plus a broader compatibility report.
