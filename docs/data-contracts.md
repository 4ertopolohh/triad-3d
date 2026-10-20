# Data and contracts

## Native `.triad3d` container (TASK-010A)

The native file is a ZIP with exactly one `manifest.json`, one `document.json`, and zero or more `assets/<sha256>.<ext>` entries. New documents use `schemaVersion: "1.1.0"`; the unchanged ZIP container uses `formatVersion: "1.0.0"` and `appVersion`. Each declared asset ID and path must match the document metadata, and both metadata and entry bytes must have the declared SHA-256. Supported binary filename extensions are `png`, `jpg`, `jpeg`, `webp`, `hdr`, `exr`, `glb`, and `bin`; decoding/importing these resources belongs to later tasks. No history, selection, UI state, cache, or persistent session data is stored.

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

## JSON document v1.1 and native manifest v1

- `document.json` uses the current `Project` shape and `schemaVersion: "1.1.0"`. Its authoritative machine-readable contract is [`document-v1.1.schema.json`](../src/domain/schemas/document-v1.1.schema.json). The strict [v1.0 schema](../src/domain/schemas/document-v1.schema.json) validates old documents before the built-in in-memory migration changes only `schemaVersion`. `model.revision` is persisted; session transaction revision, UI state, history, derived meshes, and asset bytes are omitted.
- `manifest.json` uses `formatVersion: "1.0.0"`, `appVersion`, `document: { path: "document.json", sha256 }`, and `assets: [{ id, path, sha256 }]`. Its schema is [`manifest-v1.schema.json`](../src/domain/schemas/manifest-v1.schema.json). Hashes are 64 hexadecimal SHA-256 digits. Paths are relative POSIX archive paths; traversal, backslashes, encoded paths, control characters, duplicate IDs and case-insensitive path collisions are rejected. This stage validates syntax only; hashing bytes and checking archive contents belong to TASK-010.
- Public pure API: `serializeProjectDocument(Project): Result<string>`, `deserializeProjectDocument(string, migrations?): Result<Project>`, `validateNativeManifest(unknown): Result<NativeManifest>`, and `migrateProjectDocument(unknown, migrations?): Result<unknown>`. Errors use `FILE_INVALID` or `SCHEMA_UNSUPPORTED`, with a field path where available. The v1.0 → v1.1 migration is built in; unknown versions are rejected.
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
