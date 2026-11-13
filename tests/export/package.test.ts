import { expect, it, vi } from "vitest";
import { prepareExport } from "../../src/exporters/package";
import { createMaterialAnimationProject } from "../fixtures/projects";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { optimizeGeometry } from "../../src/exporters/optimize-geometry";
import { unpackGeometries } from "../../src/exporters/packed-geometry";

it("retains original comparison assets and skips images shared with numeric PBR slots",async()=>{
  const bytes=new Uint8Array(await readFile(new URL("../assets/sample.png",import.meta.url))),hash=[...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(n=>n.toString(16).padStart(2,"0")).join("");
  const project=createMaterialAnimationProject(),asset={id:"image",hash,path:`assets/${hash}.png`,mediaType:"image/png",colorSpace:"srgb" as const};project.assets.push(asset);
  project.materials[0]!.textureSlots={baseColor:"image"};project.materials[0]!.textureAssetIds=["image"];
  const optimize=vi.fn(async()=>({asset,bytes,report:"fixture"}));
  const result=await prepareExport(project,()=>bytes,"max",undefined,undefined,[],undefined,optimize);
  expect(optimize).toHaveBeenCalledOnce();expect(result.referenceAssets!.get("image")).toEqual(bytes);
  project.materials[0]!.textureSlots.normal="image";optimize.mockClear();
  const shared=await prepareExport(project,()=>bytes,"max",undefined,undefined,[],undefined,optimize);
  expect(optimize).not.toHaveBeenCalled();expect(shared.files.get(`public/${asset.path}`)).toEqual(bytes);
});

it("keeps a true reference bundle when optimizing only the exported copy",async()=>{
  const project=createMaterialAnimationProject(),node=project.nodes.find(n=>n.id==="mesh-node")!;
  if(node.kind!=="mesh")throw new Error("fixture");
  node.meshSource={kind:"primitive",primitive:"sphere",parameters:{radius:1,widthSegments:64,heightSegments:32}};
  const before=structuredClone(project);
  const output=await prepareExport(project,()=>undefined,"balanced",undefined,undefined,[],geometry=>optimizeGeometry(geometry,{ratio:.5,error:.01}));
  expect(project).toEqual(before);expect(output.referenceBundle).toBeDefined();
  expect(output.bundle.geometries["mesh-node"]!.indices!.length).toBeLessThan(output.referenceBundle!.geometries["mesh-node"]!.indices!.length);
  const unpacked=await unpackGeometries(JSON.parse(new TextDecoder().decode(output.files.get("src/geometry.json"))));
  expect(unpacked).toEqual(output.bundle.geometries);
  expect(JSON.parse(new TextDecoder().decode(output.files.get("src/model.json"))).geometries).toEqual({});
  expect(output.bundle.project.nodes.find(n=>n.id==="mesh-node")).toMatchObject({meshSource:{kind:"baked"}});
  if(process.env.TRIAD_OPTIMIZED_EXPORT)for(const [path,bytes]of output.files){const target=join(process.env.TRIAD_OPTIMIZED_EXPORT,path);await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes);}
});

it("does not retain duplicate editable arrays in the runtime document",async()=>{
  const project=createMaterialAnimationProject(),node=project.nodes.find(n=>n.id==="mesh-node")!;
  if(node.kind!=="mesh")throw new Error("fixture");
  node.meshSource={kind:"editable",positions:[0,0,0,1,0,0,0,1,0],indices:[0,1,2]};
  const prepared=await prepareExport(project,()=>undefined,"max");
  const saved=JSON.parse(new TextDecoder().decode(prepared.files.get("src/model.json")));
  expect(saved.project.nodes.find((n:{id:string})=>n.id==="mesh-node").meshSource).toEqual({kind:"baked"});
  expect(saved.geometries["mesh-node"].positions).toEqual(node.meshSource.positions);
  expect(node.meshSource.kind).toBe("editable");
});

it("packages actual geometry, surface runtime, animation and standalone sources deterministically", async () => {
  const project = createMaterialAnimationProject();
  project.interactions=[{id:"pulse",nodeId:"mesh-node",name:"Пульсация",enabled:true,priority:0,blend:"additive",weight:1,releaseSeconds:.1,event:"time",condition:{kind:"always"},action:{kind:"pulse",radius:3,strength:1,frequency:1}}];
  project.materials[0]!.proceduralMaps = { height: { kind: "stone",seed: 1,scale: 4,intensity: .5,resolution:128,strength:.1 } };
  const before = structuredClone(project);
  const parameters = [{name:"cubeSize",nodeId:"mesh-node",property:"scale" as const,defaultValue:2}];
  const result = await prepareExport(project,() => undefined,"balanced",undefined,undefined,parameters);
  expect(project).toEqual(before);
  expect(result.triangles).toBe(12);
  expect(result.files.has("src/renderer/surface-textures.ts")).toBe(true);
  expect(result.bundle.project.interactions).toEqual(project.interactions);expect(result.files.has("src/animation/interaction-controller.ts")).toBe(true);
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
