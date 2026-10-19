# Risk register

## R-01 [HIGH] CSG on arbitrary non-manifold models fails or loses attributes
Mitigation: Prevalidate mesh, manifold-only operations, localized fallback/reject, stable modifier stack.
Tasks: TASK-003, 020

## R-02 [HIGH] WebGPU renderer incompatible with shader/postprocessing export
Mitigation: Feature capability matrix, WebGL fallback, golden tests, no promise of equivalence.
Tasks: TASK-002, 036

## R-03 [CRITICAL] Import TSX/HTML interpreted as executable source
Mitigation: No eval, AST allowlist, file size/CPU constraints; diagnostic partial import.
Tasks: TASK-054

## R-04 [HIGH] Chrome/glass visually vary with HDRI and target site renderer
Mitigation: Golden environments + export preview + disclose dependencies and quality limits.
Tasks: TASK-035, 046

## R-05 [HIGH] Browser GPU/RAM exhausts on thousands of meshes
Mitigation: Workers, instancing, lazy evaluation, memory profiling, limits with user warning.
Tasks: TASK-027, 063

## R-06 [ACCEPTED] Unsaved work irrecoverable after closing tab
Mitigation: User expressly accepts; explicit Save project, dirty marker, beforeunload best-effort.
Tasks: TASK-013

## R-07 [HIGH] Loop not truly seamless with physics/user input
Mitigation: Deterministic base layers, end pose/tangent check, separate external interaction.
Tasks: TASK-043, 051

## R-08 [HIGH] GlTF loses custom interactive logic
Mitigation: Separate TSX runtime vs GLB; exact compatibility report; no silent loss.
Tasks: TASK-044, 056

## R-09 [MEDIUM] Browser-only optimization lacks native Sharp/encoder features
Mitigation: Check browser pipelines, offer WASM/Canvas/WebCodecs, compare outputs.
Tasks: TASK-060

## R-10 [MEDIUM] Unlicensed fonts/materials packaged into app/export
Mitigation: Audit licenses, do not copy proprietary fonts without verified rights.
Tasks: TASK-005, 064

## R-11 [HIGH] Scope of advanced modeling overloads MVP
Mitigation: Stage gates and hard MVP boundary; avoid claiming advanced features complete.
Tasks: TASK-048

## R-12 [MEDIUM] Source change propagates unexpectedly to copied models
Mitigation: Opt-in revision sync, per-instance override and diff preview.
Tasks: TASK-050
