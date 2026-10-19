# Data and contracts

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

## JSON document and native manifest v1

- `document.json` uses the current `Project` shape and `schemaVersion: "1.0.0"`. Its authoritative machine-readable contract is [`document-v1.schema.json`](../src/domain/schemas/document-v1.schema.json). `model.revision` is persisted; session transaction revision, UI state, history, derived meshes, and asset bytes are omitted.
- `manifest.json` uses `formatVersion: "1.0.0"`, `appVersion`, `document: { path: "document.json", sha256 }`, and `assets: [{ id, path, sha256 }]`. Its schema is [`manifest-v1.schema.json`](../src/domain/schemas/manifest-v1.schema.json). Hashes are 64 hexadecimal SHA-256 digits. Paths are relative POSIX archive paths; traversal, backslashes, encoded paths, control characters, duplicate IDs and case-insensitive path collisions are rejected. This stage validates syntax only; hashing bytes and checking archive contents belong to TASK-010.
- Public pure API: `serializeProjectDocument(Project): Result<string>`, `deserializeProjectDocument(string, migrations?): Result<Project>`, `validateNativeManifest(unknown): Result<NativeManifest>`, and `migrateProjectDocument(unknown, migrations?): Result<unknown>`. Errors use `FILE_INVALID` or `SCHEMA_UNSUPPORTED`, with a field path where available. No migration is registered until a real earlier schema exists.
- Engineering input guards: 16 MiB JSON, depth 64, and 250,000 traversed values. These are defensive limits, not approved scene performance limits. Strict schema validation does not coerce, remove, or default properties. All imports remain detached from EditorStore until TASK-010.

The earlier illustrative example used `formatVersion`, `projectId`, and `scene.modelInstances` inside the document. The implemented domain type instead uses `schemaVersion`, `id`, and `scene.instances`; TASK-009 fixes the JSON contract to those existing types without inventing fields.

## Error codes

FILE_INVALID / SCHEMA_UNSUPPORTED / GEOMETRY_NON_MANIFOLD / GEOMETRY_DEGENERATE / JOB_CANCELLED / ASSET_DECODE_FAILED / EXPORT_UNSUPPORTED / IMPORT_UNRECOGNIZED_CODE / INVALID_REFERENCE.
