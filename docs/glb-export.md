# GLB export

Prepare the export package, expand “GLB и отчёт о потерях”, then prepare GLB. Read its loss report before downloading. Conversion runs in a Worker; cancellation terminates it without modifying the project. The GLB uses the domain-derived geometry already prepared by the production exporter.

Supported: hierarchy/transforms, visible geometry, vertex colors, material groups, compatible scalar PBR, baseColor/normal/roughness/metalness/emissive raster maps, projected UVs and repeat samplers, procedural roughness baked into PNG, active transform clip tracks. Baked animation is bounded; excessive sample counts are rejected. Homogeneous step tracks remain discrete; Bezier and mixed interpolation are sampled at the clip FPS with original key times.

Reported losses: hidden nodes, HDRI/environment intensity, camera/background/lights/tone mapping, bump/height without normal baking, non-portable triplanar color, runtime interactions and React props. Loop markers and mute/solo are fixed during export; glTF does not retain arbitrary runtime behavior. Native `.triad3d` remains the editable project.

Checks: independent GLTFLoader roundtrip for geometry/PBR/animation, hidden tracks, budgets/cancel and vertex-color material overrides on prototype-like IDs. Browser Worker export of imported cube+torus and chrome/glass/stone passed. Downloaded material GLB contains 3 meshes, 3 materials and one embedded roughness image. `qa/glb.html` checks asymmetric image orientation and REPEAT samplers through independent loading; result `qa/glb-texture-roundtrip.json`. Screenshots: `qa/glb-export.png`, `qa/glb-material-report.png`.

Implementation follows the bundled Three.js GLTFExporter; supported extension behavior is documented at https://threejs.org/docs/pages/GLTFExporter.html . Viewer support for material extensions varies.
