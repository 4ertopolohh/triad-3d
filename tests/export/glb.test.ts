import { afterEach, expect, it, vi } from "vitest";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { prepareExport } from "../../src/exporters/package";
import { exportGlb } from "../../src/exporters/glb";
import { createMaterialAnimationProject } from "../fixtures/projects";
import { createHash } from "node:crypto";
import { createEditorStore } from "../../src/app/editor-store";

// Browser FileReader boundary only; actual exporter and independent loader execute unchanged.
class Reader { result:ArrayBuffer|null=null;onloadend:(()=>void)|null=null;readAsArrayBuffer(blob:Blob){void blob.arrayBuffer().then(value=>{this.result=value;this.onloadend?.();});} }
afterEach(()=>vi.unstubAllGlobals());
it("bakes independent instance speed and paused overrides into a scene clip",async()=>{
  vi.stubGlobal("FileReader",Reader);const store=createEditorStore(createMaterialAnimationProject()),transform={position:[0,0,0] as const,rotationQuat:[0,0,0,1] as const,scale:[1,1,1] as const};
  for(let i=0;i<3;i++)store.executeCommand({commandId:`add${i}`,type:"ADD_INSTANCE",targetIds:[`i${i}`],payload:{id:`i${i}`,transform}},i);
  for(const [i,clipId,speed]of [[1,"clip-1",2],[2,null,1]]as const)store.executeCommand({commandId:`set${i}`,type:"SET_INSTANCE",targetIds:[`i${i}`],payload:{id:`i${i}`,transform,visible:true,animationOverride:{clipId,speed}}},store.getSnapshot().document.revision);
  const prepared=await prepareExport(store.captureDocument().project,()=>undefined,"max"),output=await exportGlb(prepared.bundle,()=>undefined),loaded=await new GLTFLoader().parseAsync(await output.blob.arrayBuffer(),"");
  const meshes:T.Mesh[]=[];loaded.scene.traverse(o=>{if(o instanceof T.Mesh)meshes.push(o);});expect(meshes).toHaveLength(3);expect(loaded.animations).toHaveLength(1);
  const mixer=new T.AnimationMixer(loaded.scene);mixer.clipAction(loaded.animations[0]!).play();mixer.setTime(.5);
  expect(meshes.map(m=>m.parent!.position.y)).toEqual([.25,.5,0]);mixer.stopAllAction();mixer.uncacheRoot(loaded.scene);meshes.forEach(m=>{m.geometry.dispose();(m.material as T.Material).dispose();});
});
it("keeps authored step transition time when the GLB sampler encodes Float32",async()=>{
  vi.stubGlobal("FileReader",Reader);const project=createMaterialAnimationProject();
  project.keyframes[0]!.interpolation="step";project.keyframes[1]!.timeSeconds=.7;project.keyframes[1]!.interpolation="step";
  const prepared=await prepareExport(project,()=>undefined,"max"),result=await exportGlb(prepared.bundle,()=>undefined);
  const loaded=await new GLTFLoader().parseAsync(await result.blob.arrayBuffer(),"");
  const mixer=new T.AnimationMixer(loaded.scene);mixer.clipAction(loaded.animations[0]!).play();let mesh:T.Mesh|undefined;loaded.scene.traverse(o=>{if(o instanceof T.Mesh)mesh=o;});
  mixer.setTime(.6999);expect(mesh!.parent!.position.y).toBe(0);mixer.setTime(.7001);expect(mesh!.parent!.position.y).toBe(1);mixer.stopAllAction();mixer.uncacheRoot(loaded.scene);
  loaded.scene.traverse(o=>{if(o instanceof T.Mesh){o.geometry.dispose();(o.material as T.Material).dispose();}});
});
it("roundtrips actual geometry, PBR and sampled animation through the independent glTF loader",async()=>{
  vi.stubGlobal("FileReader",Reader);
  const project=createMaterialAnimationProject(),before=structuredClone(project);
  const prepared=await prepareExport(project,()=>undefined,"max"),result=await exportGlb(prepared.bundle,()=>undefined);
  expect(project).toEqual(before);
  const loaded=await new GLTFLoader().parseAsync(await result.blob.arrayBuffer(),"");
  const meshes:T.Mesh[]=[];loaded.scene.traverse(o=>{if(o instanceof T.Mesh)meshes.push(o);});
  expect(meshes).toHaveLength(1);expect(meshes[0]!.geometry.index!.count).toBe(36);
  expect((meshes[0]!.material as T.MeshStandardMaterial).metalness).toBe(1);
  expect(loaded.animations).toHaveLength(1);expect(loaded.animations[0]!.duration).toBe(2);
  const mixer=new T.AnimationMixer(loaded.scene);mixer.clipAction(loaded.animations[0]!).play();mixer.setTime(1);
  expect(meshes[0]!.parent!.position.y).toBeCloseTo(.5,5);
  expect(result.diagnostics.some(d=>d.includes("runtime"))).toBe(true);
  mixer.stopAllAction();mixer.uncacheRoot(loaded.scene);meshes.forEach(m=>{m.geometry.dispose();(m.material as T.Material).dispose();});
});
it("retains vertex colors with a material override on an imported asset with a prototype-like ID",async()=>{
  vi.stubGlobal("FileReader",Reader);const project=createMaterialAnimationProject();project.animations=[];project.tracks=[];project.keyframes=[];
  const first=await prepareExport(project,()=>undefined,"max");const geometry=first.bundle.geometries["mesh-node"]!;geometry.colors=geometry.positions.map((_,i)=>i%3===0?1:0);
  const bytes=new Uint8Array(await (await exportGlb(first.bundle,()=>undefined)).blob.arrayBuffer()),hash=createHash("sha256").update(bytes).digest("hex");
  const node=project.nodes.find(n=>n.id==="mesh-node")!;if(node.kind!=="mesh")throw new Error("mesh");node.id="toString";node.meshSource={kind:"asset",assetId:"source"};project.nodes.find(n=>n.id==="nested-group")!.children=["toString"];
  project.assets.push({id:"source",hash,path:`assets/${hash}.glb`,mediaType:"model/gltf-binary",colorSpace:"none"});
  const second=await prepareExport(project,()=>bytes,"max");second.bundle.geometries={...second.bundle.geometries};
  const output=await exportGlb(second.bundle,()=>bytes),loaded=await new GLTFLoader().parseAsync(await output.blob.arrayBuffer(),"");
  const meshes:T.Mesh[]=[];loaded.scene.traverse(o=>{if(o instanceof T.Mesh)meshes.push(o);});expect(meshes).toHaveLength(1);
  expect((meshes[0]!.material as T.MeshStandardMaterial).vertexColors).toBe(true);expect(meshes[0]!.geometry.getAttribute("color").getX(0)).toBeCloseTo(1);
  meshes.forEach(m=>{m.geometry.dispose();(m.material as T.Material).dispose();});
});
it("omits hidden animated nodes and rejects oversized bake or cancellation",async()=>{
  vi.stubGlobal("FileReader",Reader);const project=createMaterialAnimationProject();
  project.nodes.find(n=>n.id==="mesh-node")!.visible=false;
  const prepared=await prepareExport(project,()=>undefined,"max");
  const hidden=await exportGlb(prepared.bundle,()=>undefined);
  const loaded=await new GLTFLoader().parseAsync(await hidden.blob.arrayBuffer(),"");expect(loaded.animations).toHaveLength(0);
  prepared.bundle.project.nodes.find(n=>n.id==="mesh-node")!.visible=true;
  prepared.bundle.project.animations[0]!.durationSeconds=86400;
  await expect(exportGlb(prepared.bundle,()=>undefined)).rejects.toThrow("бюджет");
  const controller=new AbortController();controller.abort();await expect(exportGlb(prepared.bundle,()=>undefined,controller.signal)).rejects.toThrow();
});
