import { expect, it } from "vitest";
import { prepareExport } from "../../src/exporters/package";
import { createMaterialAnimationProject } from "../fixtures/projects";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

it("packages actual geometry, surface runtime, animation and standalone sources deterministically", async () => {
  const project = createMaterialAnimationProject();
  project.materials[0]!.proceduralMaps = { height: { kind: "stone",seed: 1,scale: 4,intensity: .5,resolution:128,strength:.1 } };
  const before = structuredClone(project);
  const parameters = [{name:"cubeSize",nodeId:"mesh-node",property:"scale" as const,defaultValue:2}];
  const result = await prepareExport(project,() => undefined,"balanced",undefined,undefined,parameters);
  expect(project).toEqual(before);
  expect(result.triangles).toBe(12);
  expect(result.files.has("src/renderer/surface-textures.ts")).toBe(true);
  expect(result.files.has("src/materials/procedural/generate.ts")).toBe(true);
  expect(new TextDecoder().decode(result.files.get("src/animation/timeline.ts"))).not.toContain("editor-store");
  const again = await prepareExport(project,() => undefined,"balanced",undefined,undefined,parameters);
  expect(new TextDecoder().decode(result.files.get("src/TriadModel.tsx"))).toContain("cubeSize?: number");
  expect(again.files).toEqual(result.files);
  if (process.env.TRIAD_PRODUCTION_EXPORT) for (const [path,bytes] of result.files) { const target = join(process.env.TRIAD_PRODUCTION_EXPORT,path); await mkdir(dirname(target),{recursive:true}); await writeFile(target,bytes); }
});

it("cancels without modifying the document", async () => {
  const project = createMaterialAnimationProject();
  const controller = new AbortController(); controller.abort();
  await expect(prepareExport(project,() => undefined,"lite",controller.signal)).rejects.toThrow();
});


it("rejects injectable and reserved prop names and invalid defaults before packaging", async () => {
  for (const [name,value] of [["onError",1],["x;alert(1)",1],["size",-1]] as const)
    await expect(prepareExport(createMaterialAnimationProject(),() => undefined,"max",undefined,undefined,[{name,nodeId:"mesh-node",property:"scale",defaultValue:value}])).rejects.toThrow("prop");
});


it("keeps prototype-like node IDs as own data without changing Object.prototype", async () => {
  const project = createMaterialAnimationProject();
  project.nodes.find(n => n.id === "mesh-node")!.id = "__proto__";
  project.nodes.find(n => n.id === "nested-group")!.children = ["__proto__"];
  project.tracks[0]!.nodeId = "__proto__";
  const result = await prepareExport(project,() => undefined,"max",undefined,undefined,[{name:"size",nodeId:"__proto__",property:"scale",defaultValue:2}]);
  expect(Object.hasOwn(Object.prototype,"scale")).toBe(false);
  expect(Object.hasOwn(result.bundle.geometries,"__proto__")).toBe(true);
  expect(new TextDecoder().decode(result.files.get("src/TriadModel.tsx"))).toContain('["__proto__"]');
});


it("includes a buildable single-file component only for the static asset-free subset", async () => {
  const project = createMaterialAnimationProject();project.animations=[];project.tracks=[];project.keyframes=[];
  const result = await prepareExport(project,()=>undefined,"max");
  const code = new TextDecoder().decode(result.files.get("src/StandaloneModel.tsx"));
  expect(code).toContain("export default function TriadModel");
  expect(code).not.toMatch(/from ["']\.\.?\//);
  if (process.env.TRIAD_PRODUCTION_EXPORT) await writeFile(join(process.env.TRIAD_PRODUCTION_EXPORT,"src/StandaloneModel.tsx"),code);
});
