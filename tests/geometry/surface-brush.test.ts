import { materialProjectionGeometry } from "../../src/renderer/planar-projection";
import { expect, it } from "vitest";
import { surfaceStroke, type SurfaceStroke } from "../../src/geometry/surface-brush";
import { convertPrimitiveToEditable, editableGeometry, extrudeEditableFace, validateEditableSource } from "../../src/geometry/mesh-edit";
import { createMaterialAnimationProject } from "../fixtures/projects";
import { createEditorStore } from "../../src/app/editor-store";
import { serializeProjectDocument, deserializeProjectDocument } from "../../src/domain/project-serialization";
import { buildMeshTopology } from "../../src/geometry/mesh-topology";

const cube = () => convertPrimitiveToEditable({kind:"primitive",primitive:"cube",parameters:{size:1}});
const stroke: SurfaceStroke = {mode:"paint",samples:[[.5,.5,.5]],radius:.2,strength:1,symmetry:"off",shape:"round",fill:false,color:[1,0,0],materialSlot:1};

it("paints coincident seam vertices once per stroke and preserves geometry", () => {
  const source = cube(), before = structuredClone(source);
  const result = surfaceStroke(source,stroke);
  expect(result).toEqual(surfaceStroke(source,{...stroke,samples:[...stroke.samples,...stroke.samples]}));
  expect(source).toEqual(before);
  expect(result.positions).toBe(source.positions); expect(result.indices).toBe(source.indices);
  for (let i=0; i<source.positions.length; i+=3) if (source.positions.slice(i,i+3).every(v => v === .5)) expect(result.colors!.slice(i,i+3)).toEqual([1,0,0]);
  expect(validateEditableSource(result)).toBeNull();
  expect(surfaceStroke(source,{...stroke,strength:0})).toBe(source);
});

it("fills materials and retains color/group attributes through extrusion", () => {
  const painted = surfaceStroke(cube(),{...stroke,fill:true});
  const result = surfaceStroke(painted,{...stroke,mode:"material",fill:true});
  expect(result.faceMaterials).toEqual(Array(12).fill(1));
  const topology = buildMeshTopology(result)!;
  const extruded = extrudeEditableFace(result,topology.faces[0]!.id,.1);
  expect(extruded.colors).toHaveLength(extruded.positions.length);
  expect(extruded.faceMaterials).toHaveLength(extruded.indices.length/3);
  expect(extruded.faceMaterials!.every(n => n === 1)).toBe(true);
  const geometry = editableGeometry(extruded);
  expect(geometry.getAttribute("color").count).toBe(extruded.positions.length/3);
  expect(geometry.groups).toEqual([{start:0,count:extruded.indices.length,materialIndex:1}]);
  geometry.dispose();
});

it("commits one reversible surface stroke and roundtrips the document", () => {
  const project = createMaterialAnimationProject();
  const node = project.nodes.find(n => n.kind === "mesh")!;
  if (node.kind !== "mesh") throw new Error("fixture");
  node.meshSource = cube();
  const store = createEditorStore(project);
  const command = {commandId:"paint",type:"APPLY_SURFACE_STROKE" as const,targetIds:[node.id] as [string],payload:{nodeId:node.id,stroke:{...stroke,fill:true}}};
  expect(store.executeCommand(command,0).ok).toBe(true);
  const result = store.captureDocument().project;
  const serialized = serializeProjectDocument(result); if (!serialized.ok) throw new Error(serialized.error.message);
  const reopened = deserializeProjectDocument(serialized.value); expect(reopened.ok).toBe(true); if (reopened.ok) expect(reopened.value).toEqual(result);
  expect(store.undo(1).ok).toBe(true); expect(store.captureDocument().project).toEqual(project);
  expect(store.redo(2).ok).toBe(true); expect(store.captureDocument().project).toEqual(result);
  expect(store.executeCommand({...command,payload:{nodeId:node.id,stroke:{...stroke,mode:"material"}}},3).ok).toBe(false);
  expect(store.captureDocument().project).toEqual(result);
});


it("maps material groups independently without losing paint or source vertex correspondence", () => {
  const source = surfaceStroke(cube(),{...stroke,fill:true});
  source.faceMaterials = Array(12).fill(0); source.faceMaterials[0] = 1;
  const geometry = editableGeometry(source);
  const result = materialProjectionGeometry(geometry,[{mode:"uv"},{mode:"planar",axis:"z",tiling:[2,3],offset:[.1,.2]}]);
  const p = result.getAttribute("position"), uv = result.getAttribute("uv");
  expect(uv.getX(0)).toBeCloseTo(p.getX(0)*2+.1);
  expect(uv.getY(0)).toBeCloseTo(p.getY(0)*3+.2);
  const originalIndex = source.indices[3]!;
  expect(uv.getX(3)).toBeCloseTo(source.uv![2*originalIndex]!);
  expect(result.getAttribute("color").getY(0)).toBe(0);
  expect(result.userData.sourceVertexIndices[3]).toBe(originalIndex);
  result.dispose(); geometry.dispose();
});


it("retains missing-UV provenance for unprojected slots", () => {
  const source = cube(); delete source.uv; source.faceMaterials = Array(12).fill(0); source.faceMaterials[0] = 1;
  const geometry = editableGeometry(source);
  const projected = materialProjectionGeometry(geometry,[{mode:"planar",axis:"x",tiling:[1,1],offset:[0,0]},{mode:"uv"}]);
  expect(projected.getAttribute("uv")).toBeDefined();
  expect(projected.userData.missingUvSlots).toEqual([1]);
  projected.dispose(); geometry.dispose();
});
