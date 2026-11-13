# Data and contracts

Current document version: **1.13.0**, schema `src/domain/schemas/document-v1.13.schema.json`. Version 1.12 is strictly validated before migration. `Modifier.kind=stamp` persists seeded projected hole/dent/spike generators; see `procedural-stamps.md`. Optional `physics` stores up to 128 typed actor configurations on Project and frozen snapshots. `SET_PHYSICS` records reversible patches; simulation state is RAM-only. See `physics.md` for collider and playback limitations. Optional `interactions` on Project and frozen snapshots stores up to 128 typed rules; `SET_INTERACTIONS` validates references and records reversible patches. Runtime toggle/hover/smoothing state is never serialized. See `interactions.md`. Optional `modelSnapshots` stores shared frozen model sources; each instance references a snapshot and may store material/animation overrides. Existing legacy instances migrate to one shared snapshot. See `model-instances.md`. Optional `Asset.license` stores 1–16384 characters of provenance/license text; it is preserved in native archives and material packs. ZIP formatVersion remains 1.0.0. Historical version sections below describe their introduction points.

Runtime export is a separate derived contract: `RuntimeProject` replaces computed mesh sources with `{kind:"baked"}` and stores geometry once in the bundle or Meshopt streams. This marker is never accepted in native Project documents. The animation evaluator depends only on node IDs/transforms and timeline data.

## Native `.triad3d` container (TASK-010A)

The native file is a ZIP with exactly one `manifest.json`, one `document.json`, and zero or more `assets/<sha256>.<ext>` entries. New documents use `schemaVersion: "1.8.0"`; the unchanged ZIP container uses `formatVersion: "1.0.0"` and `appVersion`. Each declared asset ID and path must match the document metadata, and both metadata and entry bytes must have the declared SHA-256. Supported binary filename extensions are `png`, `jpg`, `jpeg`, `webp`, `hdr`, `exr`, `glb`, and `bin`; decoding/importing these resources belongs to later tasks. No history, selection, UI state, cache, or persistent session data is stored.

The loader rejects unknown entries, ambiguous paths, unsupported versions, mismatched hashes, and input beyond temporary security limits (128 MiB archive, 256 MiB expanded, 1024 entries, 64 MiB per asset, 16 MiB document, 1 MiB manifest). These limits are protective and require separate performance profiling before changes.

## GLB import (TASK-010B)

A confirmed static GLB 2.0 is stored unchanged as `assets/<sha256>.glb` with `mediaType: model/gltf-binary` and `colorSpace: none`. One domain mesh node with identity transform points to the asset under the existing model root; glTF transforms and PBR data remain inside the binary source. No material slots or editable child meshes are synthesized. Import metadata is covered by reversible command patches, while bytes stay in RAM and in the explicit native archive. Duplicate identical GLBs reuse the existing asset ID and bytes. Unsupported animations, skinning, morph targets, multiple mesh nodes or scenes, glTF extensions and any URI are rejected before parsing; this is a partial implementation of FR-064.

## Project invariants

- Exactly one Model and one Scene.
- Node has unique stable ID and parent cannot form cycle.
- Source meshes and modifiers stored; derived mesh caches omitted from authoritative model.
- Manual archive `.triad3d` (ZIP) with manifest/document/assets; bytes pinned by hash.
- Session history in RAM only, no autosave on tab close.

## Entities

- `Project`: schemaVersion/modelId/sceneId/assets/animations
- `Model`: rootNodeId/revision/child hierarchy
- `Scene`: camera/background/HDRI/light/instances
- `Node`: id/type/transform/parent/material/modifiers
- `Modifier`: id/type/order/args/enabled
- `Material`: PBR fields + slots
- `Asset`: hash/mediaType/path/colorspace
- `AnimationClip`: duration/loop/trackRefs
- `Track`: nodeId/propertyPath/keyframes
- `InteractionRule NEXT`: typed event/condition/action

## Messages

- `executeCommand(command, expectedRevision)` returns patch+inverse or error.
- `computeGeometry(jobId, sourceMesh, orderedModifiers)` returns derived mesh/stats or error.
- `evaluateAnimation(clipId, t)` returns pose; use absolute time not accumulated deltas.
- `importNativeProject(bytes)` performs dry-run validation before replacing current document.
- `exportReact(document, quality, props)` returns TSX, assets, README and omissions.
- `exportGLTF` NEXT: compatible asset data only; runtime logic excluded.

## JSON document v1.7 and native manifest v1

- `document.json` uses the current `Project` shape and `schemaVersion: "1.7.0"`. Its authoritative machine-readable contract is [`document-v1.7.schema.json`](../src/domain/schemas/document-v1.7.schema.json). Strict [v1.0](../src/domain/schemas/document-v1.schema.json), [v1.1](../src/domain/schemas/document-v1.1.schema.json), [v1.2](../src/domain/schemas/document-v1.2.schema.json), [v1.3](../src/domain/schemas/document-v1.3.schema.json), [v1.4](../src/domain/schemas/document-v1.4.schema.json), [v1.5](../src/domain/schemas/document-v1.5.schema.json), and [v1.6](../src/domain/schemas/document-v1.6.schema.json) schemas validate old documents before sequential in-memory migrations change only `schemaVersion`. Optional `Material.textureMappings.baseColor` selects historical UV, local-space Planar projection (X=Z/Y, Y=X/Z, Z=X/Y), Box projection by dominant face normal, or Triplanar projection from local position and fourth-power normalized local normal weights. Triplanar samples the color image three times per fragment, with identical UV orientation for positive and negative faces. Box splits renderer-owned triangle corners while preserving source vertex and triangle correspondence for selection. Projected modes have positive tiling and finite offset; neither changes `MeshSource`. `model.revision` is persisted; session transaction revision, UI state, history, derived meshes, and asset bytes are omitted.
- `manifest.json` uses `formatVersion: "1.0.0"`, `appVersion`, `document: { path: "document.json", sha256 }`, and `assets: [{ id, path, sha256 }]`. Its schema is [`manifest-v1.schema.json`](../src/domain/schemas/manifest-v1.schema.json). Hashes are 64 hexadecimal SHA-256 digits. Paths are relative POSIX archive paths; traversal, backslashes, encoded paths, control characters, duplicate IDs and case-insensitive path collisions are rejected. This stage validates syntax only; hashing bytes and checking archive contents belong to TASK-010.
- Public pure API: `serializeProjectDocument(Project): Result<string>`, `deserializeProjectDocument(string, migrations?): Result<Project>`, `validateNativeManifest(unknown): Result<NativeManifest>`, and `migrateProjectDocument(unknown, migrations?): Result<unknown>`. Errors use `FILE_INVALID` or `SCHEMA_UNSUPPORTED`, with a field path where available. The v1.0 → v1.1 → v1.2 → v1.3 → v1.4 → v1.5 migrations are built in; unknown versions are rejected.
- Engineering input guards: 16 MiB JSON, depth 64, and 250,000 traversed values. These are defensive limits, not approved scene performance limits. Strict schema validation does not coerce, remove, or default properties. All imports remain detached from EditorStore until TASK-010.

The earlier illustrative example used `formatVersion`, `projectId`, and `scene.modelInstances` inside the document. The implemented domain type instead uses `schemaVersion`, `id`, and `scene.instances`; TASK-009 fixes the JSON contract to those existing types without inventing fields.

## Error codes

FILE_INVALID / SCHEMA_UNSUPPORTED / GEOMETRY_NON_MANIFOLD / GEOMETRY_DEGENERATE / JOB_CANCELLED / ASSET_DECODE_FAILED / EXPORT_UNSUPPORTED / IMPORT_UNRECOGNIZED_CODE / INVALID_REFERENCE.

## TASK-021 modifier evaluation

Enabled Boolean modifiers use `parameters: { operation: "subtract" | "union" | "intersect", cutterNodeId: string }`. This fits the existing document v1 parameter map without a schema change. `node.modifierIds` defines stack order; the corresponding `Modifier.order` values must be strictly increasing.

`ModifierEvaluator.evaluate(project, meshNodeId, signal?)` returns a discriminated success/error result with detached local-space `MeshData`, `empty`, CSG warnings, applied modifier IDs and an optional fallback after failure. Asset-backed meshes require a local `assetResolver` that supplies detached geometry and a content fingerprint. The evaluator never writes Project or history. It owns an in-memory, byte-bounded LRU stage cache; `clearCache()` and `dispose()` release cached buffers. A single evaluator accepts one active job at a time. Boolean uses `CsgService`; UV, authored normals, material groups and slots are not preserved by CSG. SceneSync is not yet connected to this service.

## CODEX-024A editable mesh

`MeshSource { kind: "editable", positions: number[], indices: number[], uv?: number[] }` stores local XYZ render vertices and triangle indices as JSON arrays. UV has two values per render vertex. Geometry is capped at 64 MiB of Float32 positions/UV and Uint32 indices; all coordinates must be finite and representable as Float32. Indices must be in range, and triangles must have nonzero area under the current `validateMesh` threshold. That check does not prove manifoldness or absence of self-intersections.

`CONVERT_PRIMITIVE_TO_EDITABLE` converts a supported closed primitive explicitly and reversibly. Invalid or open generated geometry is rejected with a diagnostic. `TRANSLATE_EDITABLE_VERTICES` selects render vertex indices, groups coincident local XYZ by rounding each coordinate to the nearest 1e-6 unit, and moves every render vertex in each group. The index buffer and UV seams remain intact. Position values are rounded to Float32 before validation, matching renderer/evaluator buffers. Neither operation commits when validation fails; a zero delta is a no-op. Active modifiers on the edited node and active Boolean dependents block editing until candidate graph validation exists; disabled modifiers remain stored. GLB is not converted. The spike TSX exporter reports `EXPORT_UNSUPPORTED` for editable meshes.
## CODEX-032B baseColor texture binding

`Material.textureSlots?.baseColor` is an explicit asset ID for PNG, JPEG or WebP. The older `textureAssetIds` array remains intact but has no implicit channel assignment. Project validation checks existence and MIME; the editor action additionally checks RAM bytes and selection, revision and project epoch before committing one Undo step. The renderer uses the image with sRGB color space on meshes with UV, keeps shared GPU textures while referenced, and reports missing UV or decode errors without changing the document. The TSX spike reports `TEXTURES_OMITTED` for this slot; full texture export is outside this task. Native ZIP `formatVersion` remains 1.0.0.

## CODEX-034B procedural roughness

`Material.proceduralMaps?.roughness` stores only a validated Grain or Scratches configuration (seed uint32, scale 0.25–64, intensity 0–1, resolution 128/256/512, optional direction for Scratches). It is absent from migrated 1.0–1.5 documents. SceneSync derives an RGBA `NoColorSpace` DataTexture whose green channel is `clamp(baseRoughness + (pixel - 128) / 255, 0, 1)` quantized to 8 bits; runtime roughness is 1 while the map is bound. Intensity zero leaves the original scalar roughness and binds no map. Scene-local reference counting releases textures after their last material user. UV is required, including when baseColor uses Triplanar. The document stores no pixels or GPU state; the native ZIP formatVersion stays 1.0.0. The TSX spike emits `PROCEDURAL_ROUGHNESS_OMITTED` because it does not export this appearance.

## TASK-035 scene settings and TASK-036 raster profiles

`SET_SCENE_SETTINGS` accepts `{ sceneId, settings: { camera, background, lights, renderSettings? } }`. It preserves Scene ID and instances, validates references and unique IDs, and records an atomic reversible scene patch. `background.environmentIntensity?` defaults to 1 (0–100); `environmentRotation?` is Y rotation in radians, default 0 (−2π…2π). `renderSettings?` contains exposure (0.01–20) and toneMapping (`aces`, `neutral`, `none`); historical default is ACES/1.25. Document 1.7.0 stores these values; 1.6 input is strictly validated before migration. ZIP formatVersion remains 1.0.0.

New environment assignments accept existing HDR/EXR assets. Historical other-type references remain readable and produce a neutral-light diagnostic. Worker decoding checks dimensions and the existing 128 MiB decoded-image budget; cancellation terminates the Worker. Replacing a project discards late results and releases derived textures. Exposure and environment changes do not rewrite materials.

Draft/Quality/Final are session-only raster resolution profiles: pixel-ratio caps 1/1.5/2 and maximum backing-buffer dimensions 2048/3072/4096, also capped by devicePixelRatio. They do not change Project, add postprocessing or enable path tracing. Both automatic WebGPU and forced WebGL2 use the existing WebGPURenderer.


## Document 1.8 — surface maps and timeline

Optional material channels: baseColor/normal/bump/roughness/metalness/emissive; each assigned channel references an existing raster asset (PNG/JPEG/WebP). Normal/bump strengths are finite 0..10. Stone height has deterministic seed, scale, intensity, resolution and strength. These are visual maps, not geometry displacement. Normal maps take precedence over height. Linear data maps and sRGB emissive/baseColor samplers remain separate. Existing 1.7 documents migrate without adding fields.

`SET_TIMELINE` atomically replaces clips/tracks/keys with inverse history patches. Keys match channel arity; quaternions are normalized; scale keys remain positive. Duplicate channel/time pairs are rejected in generic edits; recording replaces same-time keys. Optional cubic easing is [x1,y1,x2,y2]; x stays 0..1, and scale y stays 0..1. Optional clip fps (1..240), loopStartSeconds/loopEndSeconds and track muted/solo serialize in 1.8. Absolute-time evaluation is derived and never writes authored transforms. Recording converts approved transform commands into key commands; camera navigation does not issue model transform commands. Playback/time/recording rate are session state.

Production ZIP includes a separate Vite/React runtime, source geometry buffers (modifiers baked), textures, original verified static GLBs, materials, timeline and scene settings. It carries no editor store/history. Asset URLs are relative and overridable via assetBaseUrl. Every GLB passes static inspection before packaging; runtime loader denies external URIs. Max/Balanced/Lite currently change raster resolution and antialiasing, not mesh simplification. Runtime supports global width/height/scale/color/speed/playing/clipId/time props. User-selected per-object props and standalone single-file export remain open.


Editable meshes in document 1.8 may carry `colors` (linear RGB, three components per render vertex, [0,1]) and `faceMaterials` (one slot index per triangle, 0–255). Mesh validation includes their byte budget. Paint uses maximum sample influence per stroke, Material assigns triangle centroids within the footprint, and fill applies to the whole selected mesh. Displace supports round/box/fill with its existing displacement guard. Extrusion propagates color and face slots, including side triangles. Removal of a referenced slot fails; unused-slot removal reindexes later slots. Active modifier stacks on painted meshes fail validation rather than silently dropping these attributes.

Export profile preview uses the same standalone runtime and prepared geometry as ZIP, with RAM Blob URLs only in the editor preview. Generated object props have validated identifiers and positive scale / HEX color defaults. Dynamic IDs use dictionaries without prototypes and computed keys. Per-group Planar/Box projections preserve vertex paint and source-index correspondence; UV mapping is baked only in derived geometry.


The 1.8 roughness pattern set includes grain, scratches, noise, marble and brushed-metal. Direction is mandatory for scratches/brushed-metal. Stone remains a height/bump pattern. PNG baking stores absolute roughness (use material roughness 1 when assigning) or scalar height, preserving row orientation and linear data. `Track.pivot` records a generated rotation center in parent coordinates; ordinary editable keys carry motion. Oscillate/bounce presets also generate ordinary keys and refuse existing channels.

A static asset-free subset can additionally export `StandaloneModel.tsx`, with React/Three external imports only. Animation, procedural maps, external assets and code over 512 KiB require the full ZIP. This subset uses Max raster settings and global width/height/scale/color props; selected object props belong to the full runtime.
