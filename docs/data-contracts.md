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

## Data sample

```json
{
  "formatVersion": "1.0.0",
  "projectId": "project-unique-id",
  "model": {"id": "model-1", "rootNodeId": "root-1", "revision": 4},
  "scene": {"id": "scene-1", "modelInstances": []},
  "nodes": [
    {"id": "root-1", "parentId": null, "kind": "group",
     "name": "Модель", "children": ["torus-1"],
     "transform": {"position": [0,0,0], "rotationQuat": [0,0,0,1], "scale": [1,1,1]},
     "visible": true, "locked": false, "materialSlots": [], "modifierIds": []}
  ],
  "modifiers": [], "materials": [], "animations": [], "assets": []
}
```

## Error codes

FILE_INVALID / SCHEMA_UNSUPPORTED / GEOMETRY_NON_MANIFOLD / GEOMETRY_DEGENERATE / JOB_CANCELLED / ASSET_DECODE_FAILED / EXPORT_UNSUPPORTED / IMPORT_UNRECOGNIZED_CODE / INVALID_REFERENCE.
